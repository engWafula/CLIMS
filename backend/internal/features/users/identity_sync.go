package users

import (
	"context"
	"errors"
	"strings"
	"time"

	"clims-backend/internal/features/audit"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	ErrIdentityAccountIneligible = errors.New("CLIMS account is missing or ineligible")
	ErrIdentityLinkConflict      = errors.New("CLIMS identity link conflicts with an existing link")
	// ErrSignInRevoked refuses a portal sign-in whose ID token was issued at or before the account's
	// last identity-sync revoke.
	ErrSignInRevoked = errors.New("CLIMS sessions were revoked after this sign-in began")
)

// IdentitySyncAccount is an eligible account and, when it has one, the subject linked for the
// requested issuer.
type IdentitySyncAccount struct {
	ID          uuid.UUID
	Email       string
	LinkSubject *string
}

// MaxIdentitySyncPage is the largest page the identity-sync contract allows.
const MaxIdentitySyncPage = 100

const identitySyncEligible = `u.status = 'active' AND EXISTS (
	SELECT 1 FROM role_user ru JOIN roles r ON r.id = ru.role_id WHERE ru.user_id = u.id
)`

// ListIdentitySyncAccounts returns up to limit eligible users in UUID order, each with its link for
// issuer, and whether more follow. Pass the last returned ID to resume, or nil to start.
func (r *Repository) ListIdentitySyncAccounts(ctx context.Context, issuer string, after *uuid.UUID, limit int) ([]IdentitySyncAccount, bool, error) {
	if limit < 1 || limit > MaxIdentitySyncPage {
		return nil, false, errors.New("invalid identity sync page size")
	}
	// One extra row tells whether another page exists, so the last page ends the listing itself.
	rows, err := r.DB.Query(ctx, `
		SELECT u.id, COALESCE(u.email, ''), identity.subject FROM users u
		LEFT JOIN user_oidc_identities identity ON identity.user_id = u.id AND identity.issuer = $2
		WHERE ($1::uuid IS NULL OR u.id > $1) AND `+identitySyncEligible+`
		ORDER BY u.id LIMIT $3`, after, issuer, limit+1)
	if err != nil {
		return nil, false, err
	}
	accounts, err := pgx.CollectRows(rows, pgx.RowToStructByPos[IdentitySyncAccount])
	if err != nil {
		return nil, false, err
	}
	if len(accounts) > limit {
		return accounts[:limit], true, nil
	}
	return accounts, false, nil
}

// LinkOIDCIdentity accepts a verified identity from the trusted reconciler.
// An exact retry succeeds. Either uniqueness conflict preserves the existing link.
func (r *Repository) LinkOIDCIdentity(ctx context.Context, id uuid.UUID, issuer, subject string) error {
	if id == uuid.Nil || strings.TrimSpace(issuer) == "" || strings.TrimSpace(subject) == "" {
		return errors.New("invalid CLIMS identity link")
	}
	return pgx.BeginTxFunc(ctx, r.DB, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		var userID uuid.UUID
		err := tx.QueryRow(ctx, `SELECT u.id FROM users u WHERE u.id = $1 AND `+identitySyncEligible+`
			FOR UPDATE OF u`, id).Scan(&userID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrIdentityAccountIneligible
		}
		if err != nil {
			return err
		}
		inserted, err := tx.Exec(ctx, `
			INSERT INTO user_oidc_identities (issuer, subject, user_id)
			VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, issuer, subject, userID)
		if err != nil {
			return err
		}
		var linked bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1 FROM user_oidc_identities WHERE issuer = $1 AND subject = $2 AND user_id = $3
		)`, issuer, subject, userID).Scan(&linked); err != nil {
			return err
		}
		if !linked {
			return ErrIdentityLinkConflict
		}
		if inserted.RowsAffected() == 0 {
			return nil // Already linked: a repeated sync changes nothing.
		}
		return r.audit.Record(ctx, tx, audit.Entry{Action: "user.identity_linked",
			Target:  &audit.Subject{Type: "user", ID: userID.String()},
			Details: map[string]any{"issuer": issuer, "subject": subject}})
	})
}

// RevokeOIDCSessions ends every session of the account linked to issuer and subject, which also
// invalidates their refresh tokens. The link and the account's roles stay. It reports how many
// sessions ended; an unlinked identity ends none and is not an error.
//
// In the same transaction it records the revocation time on the account, holding the account's row
// lock. CreateOIDCSession takes the same lock and refuses an ID token issued at or before that time,
// so a portal sign-in that straddles the revoke cannot leave a live session: either its session
// exists before the revoke and is ended here, or it sees the revocation and is refused.
func (r *Repository) RevokeOIDCSessions(ctx context.Context, issuer, subject string) (int64, error) {
	var ended int64
	err := pgx.BeginTxFunc(ctx, r.DB, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		// clock_timestamp() is read after the row lock is held, not when the transaction began.
		var userID string
		err := tx.QueryRow(ctx, `UPDATE users u SET sessions_revoked_at = clock_timestamp()
			FROM user_oidc_identities identity
			WHERE identity.issuer = $1 AND identity.subject = $2 AND u.id = identity.user_id
			RETURNING u.id::text`, issuer, subject).Scan(&userID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // Unlinked: no account, so no sessions to end.
		}
		if err != nil {
			return err
		}
		// A new statement sees sessions committed by a sign-in that held the lock before this revoke.
		tag, err := tx.Exec(ctx, `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP
			WHERE user_id = $1 AND revoked_at IS NULL`, userID)
		if err != nil {
			return err
		}
		ended = tag.RowsAffected()
		// Recorded like an administrator's "sign out everywhere", so the account's history shows it.
		return r.audit.Record(ctx, tx, audit.Entry{Action: "user.sessions_revoked",
			Target: &audit.Subject{Type: "user", ID: userID},
			Details: map[string]any{"source": "identity_sync", "sessions_revoked": ended,
				"issuer": issuer, "subject": subject}})
	})
	return ended, err
}

// CreateOIDCSession starts a session for the eligible account linked to issuer and subject, as the
// portal callback does after a verified sign-in. issuedAt is the ID token's iat. When the account's
// sessions were revoked at or after issuedAt it returns ErrSignInRevoked and creates nothing. A nil
// issuedAt means now, for the identity-sync test probe, which has no ID token. A missing link or an
// ineligible account returns ErrIdentityAccountIneligible.
//
// The check and the insert run under the account's row lock, the lock RevokeOIDCSessions takes, so
// they cannot interleave with a revoke. The comparison relies on Keycloak's and PostgreSQL's clocks
// agreeing (NTP); iat has whole seconds, which errs towards refusing.
func (r *Repository) CreateOIDCSession(ctx context.Context, issuer, subject string, issuedAt *time.Time, userAgent, ip string) (IssuedSession, error) {
	token, hash, err := newRefreshToken()
	if err != nil {
		return IssuedSession{}, err
	}
	issued := IssuedSession{RefreshToken: token}
	err = pgx.BeginTxFunc(ctx, r.DB, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		var revoked bool
		err := tx.QueryRow(ctx, `SELECT u.id::text,
				u.sessions_revoked_at IS NOT NULL AND u.sessions_revoked_at >= COALESCE($3::timestamptz, clock_timestamp())
			FROM users u JOIN user_oidc_identities identity ON identity.user_id = u.id
			WHERE identity.issuer = $1 AND identity.subject = $2 AND `+identitySyncEligible+`
			FOR UPDATE OF u`, issuer, subject, issuedAt).Scan(&issued.UserID, &revoked)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return ErrIdentityAccountIneligible
		case err != nil:
			return err
		case revoked:
			return ErrSignInRevoked
		}
		return r.insertSession(ctx, tx, &issued, hash, userAgent, ip)
	})
	if err != nil {
		return IssuedSession{}, err
	}
	return issued, nil
}

package users

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"

	"clims-backend/internal/features/audit"
	"clims-backend/internal/pkg/request"
	"clims-backend/internal/pkg/response"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"
)

const (
	// AccessTokenLifetime is short: a revoked session is rejected at once anyway, and refresh renews it.
	AccessTokenLifetime = 15 * time.Minute
	// SessionLifetime caps how long a login can be refreshed before the user signs in again.
	SessionLifetime = 30 * 24 * time.Hour
	// refreshReuseGrace lets two tabs refresh the same session at once without it looking like theft.
	refreshReuseGrace = 30 * time.Second
)

var (
	// ErrRefreshInvalid covers unknown, expired, revoked and already-used refresh tokens.
	ErrRefreshInvalid  = errors.New("refresh token is invalid or expired; sign in again")
	ErrAccountDisabled = errors.New("account is disabled")
)

const sessionKey = "session_id"

type Session struct {
	ID           string     `json:"id"`
	UserAgent    *string    `json:"user_agent"`
	IPAddress    *string    `json:"ip_address"`
	CreatedAt    time.Time  `json:"created_at"`
	LastSeenAt   time.Time  `json:"last_seen_at"`
	ExpiresAt    time.Time  `json:"expires_at"`
	RevokedAt    *time.Time `json:"revoked_at"`
	RefreshedAt  *time.Time `json:"refreshed_at"`
	RefreshCount int        `json:"refresh_count"`
	Current      bool       `json:"current"`
}

// IssuedSession is a live session and the refresh token for it. The token is shown once; only its hash is stored.
type IssuedSession struct {
	ID           string
	UserID       string
	RefreshToken string
	ExpiresAt    time.Time
}

func newRefreshToken() (string, []byte, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	return token, hashToken(token), nil
}

func hashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// CreateSession records a login, counts it on the account, and returns the session with its refresh token.
func (r *Repository) CreateSession(ctx context.Context, userID, userAgent, ip string) (IssuedSession, error) {
	token, hash, err := newRefreshToken()
	if err != nil {
		return IssuedSession{}, err
	}
	issued := IssuedSession{UserID: userID, RefreshToken: token}
	err = pgx.BeginFunc(ctx, r.DB, func(tx pgx.Tx) error {
		return r.insertSession(ctx, tx, &issued, hash, userAgent, ip)
	})
	return issued, err
}

// insertSession records the session for issued.UserID, counts the login on the account and audits it.
// Password and portal (OIDC) sign-ins both start their sessions here.
func (r *Repository) insertSession(ctx context.Context, tx pgx.Tx, issued *IssuedSession, hash []byte, userAgent, ip string) error {
	if err := tx.QueryRow(ctx, `INSERT INTO user_sessions (user_id, user_agent, ip_address, expires_at,
			refresh_token_hash, last_user_agent, last_ip_address)
		VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), CURRENT_TIMESTAMP + make_interval(secs => $4), $5,
			NULLIF($2, ''), NULLIF($3, ''))
		RETURNING id, expires_at`,
		issued.UserID, userAgent, ip, SessionLifetime.Seconds(), hash).Scan(&issued.ID, &issued.ExpiresAt); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET last_login_at = CURRENT_TIMESTAMP, login_count = login_count + 1
		WHERE id = $1`, issued.UserID); err != nil {
		return err
	}
	return r.audit.Record(ctx, tx, audit.Entry{Action: "auth.login_succeeded", ActorID: issued.UserID,
		SessionID: issued.ID, Target: &audit.Subject{Type: "user", ID: issued.UserID},
		Related: []audit.Subject{{Type: "session", ID: issued.ID}}})
}

// RefreshSession exchanges a refresh token for a new one on the same session. A token that was already
// rotated away is a replay, such as a stolen copy: outside a short grace window it revokes the session.
// Only security-relevant refreshes are audited: replays, refusals, and a new address or device.
func (r *Repository) RefreshSession(ctx context.Context, refreshToken, userAgent, ip string) (IssuedSession, error) {
	presented := hashToken(refreshToken)
	token, hash, err := newRefreshToken()
	if err != nil {
		return IssuedSession{}, err
	}
	issued := IssuedSession{RefreshToken: token}
	refusal, replayed := "invalid_token", false // unknown, or rotated within the grace window
	err = pgx.BeginFunc(ctx, r.DB, func(tx pgx.Tx) error {
		var live bool
		var status string
		var lastAgent, lastIP *string
		err := tx.QueryRow(ctx, `SELECT s.id, s.user_id, s.expires_at,
				s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP, u.status, s.last_user_agent, s.last_ip_address
			FROM user_sessions s JOIN users u ON u.id = s.user_id
			WHERE s.refresh_token_hash = $1 FOR UPDATE OF s`, presented).
			Scan(&issued.ID, &issued.UserID, &issued.ExpiresAt, &live, &status, &lastAgent, &lastIP)
		if errors.Is(err, pgx.ErrNoRows) {
			replayed, err = r.revokeReplayed(ctx, tx, presented)
			return err
		}
		if err != nil {
			return err
		}
		if !live {
			refusal = "session_ended"
			return ErrRefreshInvalid
		}
		if status != "active" {
			refusal = "account_disabled"
			return ErrAccountDisabled
		}
		if _, err = tx.Exec(ctx, `UPDATE user_sessions SET previous_refresh_token_hash = refresh_token_hash,
				refresh_token_hash = $2, refreshed_at = CURRENT_TIMESTAMP, refresh_count = refresh_count + 1,
				last_seen_at = CURRENT_TIMESTAMP, last_user_agent = NULLIF($3, ''), last_ip_address = NULLIF($4, '')
			WHERE id = $1`, issued.ID, hash, userAgent, ip); err != nil {
			return err
		}
		if deref(lastAgent) == userAgent && deref(lastIP) == ip {
			return nil // A routine refresh is not audited.
		}
		return r.audit.Record(ctx, tx, audit.Entry{Action: "auth.refresh_location_changed", ActorID: issued.UserID,
			SessionID: issued.ID, Target: &audit.Subject{Type: "user", ID: issued.UserID},
			Related: []audit.Subject{{Type: "session", ID: issued.ID}},
			Details: map[string]any{"previous_ip_address": deref(lastIP), "previous_user_agent": deref(lastAgent)}})
	})
	// A replay was audited when its session was revoked.
	if errors.Is(err, ErrRefreshInvalid) || errors.Is(err, ErrAccountDisabled) || (err == nil && issued.UserID == "" && !replayed) {
		entry := audit.Entry{Action: "auth.refresh_refused", Outcome: audit.OutcomeFailure, Reason: refusal}
		if issued.UserID != "" {
			entry.Target = &audit.Subject{Type: "user", ID: issued.UserID}
			entry.Related = []audit.Subject{{Type: "session", ID: issued.ID}}
		}
		if auditErr := r.audit.RecordNow(ctx, entry); auditErr != nil {
			return IssuedSession{}, auditErr
		}
	}
	if err != nil {
		return IssuedSession{}, err
	}
	if issued.UserID == "" {
		// Unknown or replayed: any revocation is committed, and the token is not honoured.
		return IssuedSession{}, ErrRefreshInvalid
	}
	return issued, nil
}

// revokeReplayed ends the session whose previous refresh token was presented again
// after the grace window, and audits it as a likely stolen token. It reports false
// when the token matches no session.
func (r *Repository) revokeReplayed(ctx context.Context, tx pgx.Tx, presented []byte) (bool, error) {
	var sessionID, userID string
	err := tx.QueryRow(ctx, `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP
		WHERE previous_refresh_token_hash = $1 AND revoked_at IS NULL
			AND refreshed_at < CURRENT_TIMESTAMP - make_interval(secs => $2)
		RETURNING id, user_id`, presented, refreshReuseGrace.Seconds()).Scan(&sessionID, &userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil // An unknown token, audited as a refusal by the caller.
	}
	if err != nil {
		return false, err
	}
	return true, r.audit.Record(ctx, tx, audit.Entry{Action: "auth.refresh_replayed", Outcome: audit.OutcomeFailure,
		Reason: "refresh_token_reused", SessionID: sessionID, Target: &audit.Subject{Type: "user", ID: userID},
		Related: []audit.Subject{{Type: "session", ID: sessionID}}, Details: map[string]any{"session_revoked": true}})
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// sessionActive reports whether the session is live, and records activity at most once a minute.
func (r *Repository) sessionActive(ctx context.Context, userID, sessionID string) (bool, error) {
	var active bool
	err := r.DB.QueryRow(ctx, `WITH live AS (
			SELECT id, last_seen_at FROM user_sessions
			WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP),
		touched AS (
			UPDATE user_sessions s SET last_seen_at = CURRENT_TIMESTAMP FROM live
			WHERE s.id = live.id AND live.last_seen_at < CURRENT_TIMESTAMP - interval '1 minute')
		SELECT EXISTS (SELECT FROM live)`, sessionID, userID).Scan(&active)
	return active, err
}

// SessionActive reports whether the user's session is live: the same check every authenticated
// request passes through ActiveUser.
func (r *Repository) SessionActive(ctx context.Context, userID, sessionID string) (bool, error) {
	return r.sessionActive(ctx, userID, sessionID)
}

// ListSessions returns the user's unexpired sessions, newest first, marking currentID.
func (r *Repository) ListSessions(ctx context.Context, userID, currentID string) ([]Session, error) {
	rows, err := r.DB.Query(ctx, `SELECT id, user_agent, ip_address, created_at, last_seen_at, expires_at,
			revoked_at, refreshed_at, refresh_count, id = $2::uuid
		FROM user_sessions WHERE user_id = $1 AND expires_at > CURRENT_TIMESTAMP
		ORDER BY created_at DESC, id DESC LIMIT 100`, userID, nullableID(currentID))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Session])
}

// RevokeSession signs out one of the user's sessions and audits it as action, such
// as "auth.logged_out"; it reports false when none was live.
func (r *Repository) RevokeSession(ctx context.Context, userID, sessionID, action string) (bool, error) {
	revoked := false
	err := pgx.BeginFunc(ctx, r.DB, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP
			WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP`, sessionID, userID)
		if err != nil || tag.RowsAffected() != 1 {
			return err
		}
		revoked = true
		return r.audit.Record(ctx, tx, audit.Entry{Action: action, Target: &audit.Subject{Type: "user", ID: userID},
			Related: []audit.Subject{{Type: "session", ID: sessionID}}})
	})
	return revoked, err
}

// RevokeAllSessions signs the user out everywhere, as an administrator's action, and
// returns how many sessions ended.
func (r *Repository) RevokeAllSessions(ctx context.Context, userID string) (int64, error) {
	var count int64
	err := pgx.BeginFunc(ctx, r.DB, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, revokeAll, userID)
		if err != nil {
			return err
		}
		count = tag.RowsAffected()
		return r.audit.Record(ctx, tx, audit.Entry{Action: "user.sessions_revoked",
			Target: &audit.Subject{Type: "user", ID: userID}, Details: map[string]any{"sessions_revoked": count}})
	})
	return count, err
}

const revokeAll = `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP
	WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP`

func nullableID(id string) *string {
	if id == "" {
		return nil
	}
	return &id
}

// CurrentSessionID is the session of the authenticated request.
func CurrentSessionID(c fiber.Ctx) string {
	id, _ := c.Locals(sessionKey).(string)
	return id
}

// Logout ends the session that made the request.
func (h *Handler) Logout(c fiber.Ctx) error {
	if _, err := h.Repo.RevokeSession(c.Context(), CurrentUser(c).ID, CurrentSessionID(c), "auth.logged_out"); err != nil {
		return response.Error(c, 500, "failed to sign out", nil)
	}
	return response.Success(c, 200, "signed out", nil)
}

// MySessions lists where the current user is signed in.
func (h *Handler) MySessions(c fiber.Ctx) error {
	return h.listSessions(c, CurrentUser(c).ID)
}

// RevokeMySession signs the current user out of one of their sessions.
func (h *Handler) RevokeMySession(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	revoked, err := h.Repo.RevokeSession(c.Context(), CurrentUser(c).ID, id, "auth.session_revoked")
	if err != nil {
		return response.Error(c, 500, "failed to revoke session", nil)
	}
	if !revoked {
		return response.Error(c, 404, "session not found", nil)
	}
	return response.Success(c, 200, "session revoked", nil)
}

// UserSessions lets an administrator see where a user is signed in.
func (h *Handler) UserSessions(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	if _, err = h.Repo.GetUserByID(c.Context(), id); err != nil {
		return accessError(c, err)
	}
	return h.listSessions(c, id)
}

// RevokeUserSessions lets an administrator sign a user out everywhere.
func (h *Handler) RevokeUserSessions(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	if _, err = h.Repo.GetUserByID(c.Context(), id); err != nil {
		return accessError(c, err)
	}
	if refused, refuseErr := h.refuseAdminChange(c, id, nil); refused {
		return refuseErr
	}
	count, err := h.Repo.RevokeAllSessions(c.Context(), id)
	if err != nil {
		return response.Error(c, 500, "failed to revoke sessions", nil)
	}
	return response.Success(c, 200, "sessions revoked", fiber.Map{"revoked": count})
}

func (h *Handler) listSessions(c fiber.Ctx, userID string) error {
	sessions, err := h.Repo.ListSessions(c.Context(), userID, CurrentSessionID(c))
	if err != nil {
		return response.Error(c, 500, "failed to list sessions", nil)
	}
	return response.Success(c, 200, "", sessions)
}

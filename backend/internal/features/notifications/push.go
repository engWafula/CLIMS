package notifications

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/jwt"
)

// AndroidChannelID is the notification channel the field app creates for pushes.
const AndroidChannelID = "default"

// PushMessage is one push to one device.
type PushMessage struct {
	Token, Title, Body string
	// Data reaches the app with the push, for opening what it is about.
	Data map[string]string
}

// PushSender sends one push. ErrInvalidToken means the device is gone; other errors are retried.
type PushSender interface {
	Send(ctx context.Context, m PushMessage) error
}

// ErrInvalidToken means the token no longer reaches a device: the app was uninstalled, its data was
// cleared, or the token was never valid. Its device is removed.
var ErrInvalidToken = errors.New("push token is no longer valid")

// permanentError is a push that will fail however often it is retried, such as a payload FCM refuses.
type permanentError struct{ error }

// FCM sends pushes through Firebase Cloud Messaging's HTTP v1 API with a service account.
type FCM struct {
	endpoint string
	client   *http.Client
}

type serviceAccount struct {
	Type         string `json:"type"`
	ProjectID    string `json:"project_id"`
	PrivateKeyID string `json:"private_key_id"`
	PrivateKey   string `json:"private_key"`
	ClientEmail  string `json:"client_email"`
	TokenURI     string `json:"token_uri"`
}

// ConfiguredFCM returns a sender from FIREBASE_CREDENTIALS_JSON (the key as JSON, or base64 of it,
// which survives env files and secret stores without quoting) or else FIREBASE_CREDENTIALS_FILE. It
// returns nil and no error when neither is set: push is then off.
func ConfiguredFCM(credentials, path string) (*FCM, error) {
	credentials = strings.TrimSpace(credentials)
	switch {
	case credentials != "" && strings.HasPrefix(credentials, "{"):
		return NewFCM([]byte(credentials))
	case credentials != "":
		decoded, err := base64.StdEncoding.DecodeString(credentials)
		if err != nil {
			return nil, errors.New("FIREBASE_CREDENTIALS_JSON is neither JSON nor base64-encoded JSON")
		}
		return NewFCM(decoded)
	case path != "":
		return LoadFCM(path)
	default:
		return nil, nil
	}
}

// LoadFCM reads a Firebase service account key file (Project settings → Service accounts).
func LoadFCM(path string) (*FCM, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read Firebase credentials: %w", err)
	}
	return NewFCM(data)
}

// NewFCM checks a service account key and returns a sender for its project. The key is checked
// here, so a wrong file is reported at startup rather than at the first push.
func NewFCM(credentials []byte) (*FCM, error) {
	var sa serviceAccount
	if err := json.Unmarshal(credentials, &sa); err != nil {
		return nil, fmt.Errorf("Firebase credentials are not JSON: %w", err)
	}
	if sa.Type != "service_account" || sa.ProjectID == "" || sa.ClientEmail == "" || sa.PrivateKey == "" {
		return nil, errors.New("Firebase credentials must be a service account key with project_id, client_email and private_key")
	}
	block, _ := pem.Decode([]byte(sa.PrivateKey))
	if block == nil {
		return nil, errors.New("Firebase credentials: private_key is not PEM")
	}
	if _, err := x509.ParsePKCS8PrivateKey(block.Bytes); err != nil {
		if _, err := x509.ParsePKCS1PrivateKey(block.Bytes); err != nil {
			return nil, errors.New("Firebase credentials: private_key is not an RSA key")
		}
	}
	tokenURL := sa.TokenURI
	if tokenURL == "" {
		tokenURL = "https://oauth2.googleapis.com/token"
	}
	cfg := &jwt.Config{
		Email:        sa.ClientEmail,
		PrivateKey:   []byte(sa.PrivateKey),
		PrivateKeyID: sa.PrivateKeyID,
		Scopes:       []string{"https://www.googleapis.com/auth/firebase.messaging"},
		TokenURL:     tokenURL,
	}
	// Access tokens are fetched with their own timeout and cached until shortly before they expire.
	tokenCtx := context.WithValue(context.Background(), oauth2.HTTPClient, &http.Client{Timeout: 15 * time.Second})
	client := oauth2.NewClient(tokenCtx, cfg.TokenSource(tokenCtx))
	client.Timeout = 15 * time.Second
	return &FCM{
		endpoint: "https://fcm.googleapis.com/v1/projects/" + sa.ProjectID + "/messages:send",
		client:   client,
	}, nil
}

// fcmPayload is a data-only message in the shape expo-notifications displays on Android
// (docs.expo.dev/push-notifications/sending-notifications-custom): it shows title and message, and
// gives the app body, a JSON object, as the notification's data. The app builds the notification
// itself, so a tap opens the app with that data even when it was closed.
func fcmPayload(m PushMessage) ([]byte, error) {
	data, err := json.Marshal(m.Data)
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{"message": map[string]any{
		"token": m.Token,
		"data": map[string]string{
			"title":     m.Title,
			"message":   m.Body,
			"body":      string(data),
			"channelId": AndroidChannelID,
		},
		// High priority wakes a phone in Doze; a push older than a day is no longer news.
		"android": map[string]any{"priority": "HIGH", "ttl": "86400s"},
	}})
}

func (f *FCM) Send(ctx context.Context, m PushMessage) error {
	payload, err := fcmPayload(m)
	if err != nil {
		return permanentError{err}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, f.endpoint, bytes.NewReader(payload))
	if err != nil {
		return permanentError{err}
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := f.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	return classifyFCM(resp.StatusCode, body)
}

// classifyFCM maps an FCM response to nil, ErrInvalidToken, a permanent error or a retryable one.
// See firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode.
func classifyFCM(status int, body []byte) error {
	if status >= 200 && status < 300 {
		return nil
	}
	var parsed struct {
		Error struct {
			Status  string `json:"status"`
			Message string `json:"message"`
			Details []struct {
				ErrorCode string `json:"errorCode"`
			} `json:"details"`
		} `json:"error"`
	}
	_ = json.Unmarshal(body, &parsed)
	code := parsed.Error.Status
	for _, d := range parsed.Error.Details {
		if d.ErrorCode != "" {
			code = d.ErrorCode
		}
	}
	err := fmt.Errorf("FCM %d %s: %s", status, code, parsed.Error.Message)
	switch {
	case code == "UNREGISTERED" || status == http.StatusNotFound:
		return ErrInvalidToken
	case code == "INVALID_ARGUMENT" && strings.Contains(strings.ToLower(parsed.Error.Message), "token"):
		return ErrInvalidToken
	case code == "SENDER_ID_MISMATCH":
		// The token belongs to another Firebase project: it will never work with these credentials.
		return ErrInvalidToken
	case status == http.StatusTooManyRequests || status >= 500 || code == "UNAVAILABLE" || code == "INTERNAL" ||
		code == "QUOTA_EXCEEDED":
		return err
	case status == http.StatusUnauthorized || status == http.StatusForbidden || code == "THIRD_PARTY_AUTH_ERROR":
		// Credentials or project settings; retrying gives an operator time to fix them.
		return err
	default:
		return permanentError{err}
	}
}

// Push worker settings.
const (
	pushBatch       = 50
	pushMaxAttempts = 6
	// A push still unsent after this long is dropped: the inbox has it, and an old alert misleads.
	pushMaxAge = 24 * time.Hour
)

// PushWorker sends queued pushes. Every replica may run one: each claims rows with SKIP LOCKED.
type PushWorker struct {
	db     *pgxpool.Pool
	sender PushSender
}

func NewPushWorker(db *pgxpool.Pool, sender PushSender) *PushWorker {
	return &PushWorker{db: db, sender: sender}
}

// Run sends due pushes every interval until ctx ends, and hourly forgets devices whose session ended.
func (w *PushWorker) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	var lastPrune time.Time
	for {
		if time.Since(lastPrune) > time.Hour {
			if err := w.prune(ctx); err != nil {
				slog.Error("push device cleanup failed", "error", err)
			}
			lastPrune = time.Now()
		}
		// Keep going while full batches come back, so a burst drains without waiting.
		for {
			sent, err := w.SendDue(ctx)
			if err != nil {
				slog.Error("push send failed", "error", err)
				break
			}
			if sent < pushBatch {
				break
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

type queuedPush struct {
	id                       string
	notificationID, userID   string
	token, title, body       string
	attempts                 int
	notificationType         string
	resourceType, resourceID *string
	reportID, deliveryID     *string
	sessionOpen, tooOld      bool
}

// SendDue claims up to one batch of due pushes and sends them. It reports how many it claimed.
//
// Claiming is one short transaction that leases the pushes (their next attempt moves past the time
// sending the whole batch can take), so no other worker sends them meanwhile. Sending happens outside
// any transaction, and each outcome is saved on its own: a slow FCM holds no locks, and a failure
// part-way through never sends the pushes that already went a second time.
func (w *PushWorker) SendDue(ctx context.Context) (int, error) {
	batch, claimed, err := w.claim(ctx)
	if err != nil {
		return 0, err
	}
	var first error
	for _, p := range batch {
		if err := w.send(ctx, p); err != nil {
			// The push stays leased and is tried again once the lease runs out.
			slog.Error("push outcome not saved", "notification", p.notificationID, "error", err)
			if first == nil {
				first = err
			}
		}
	}
	return claimed, first
}

// pushSendTimeout bounds one push; pushLease covers sending a whole batch of them.
const (
	pushSendTimeout = 20 * time.Second
	pushLease       = pushBatch*pushSendTimeout + time.Minute
)

// claim takes up to one batch of due pushes. Those that can no longer go (signed out, moved to another
// account, or stale; the inbox still has them) are deleted; the rest are leased and returned. claimed
// counts both.
func (w *PushWorker) claim(ctx context.Context) ([]queuedPush, int, error) {
	tx, err := w.db.Begin(ctx)
	if err != nil {
		return nil, 0, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT o.id::text, o.notification_id, o.user_id, o.token, o.title, o.body, o.attempts,
			n.type, n.resource_type, n.resource_id::text, n.data->>'report_id', n.data->>'delivery_id',
			s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP AND pd.user_id = o.user_id,
			o.created_at < CURRENT_TIMESTAMP - make_interval(secs => $2)
		FROM push_outbox o
		JOIN notifications n ON n.id = o.notification_id
		JOIN push_devices pd ON pd.token = o.token
		JOIN user_sessions s ON s.id = pd.session_id
		WHERE o.next_attempt_at <= CURRENT_TIMESTAMP
		ORDER BY o.next_attempt_at, o.created_at
		LIMIT $1
		FOR UPDATE OF o SKIP LOCKED`, pushBatch, pushMaxAge.Seconds())
	if err != nil {
		return nil, 0, err
	}
	var batch []queuedPush
	var gone, leased []string
	claimed := 0
	for rows.Next() {
		var p queuedPush
		if err := rows.Scan(&p.id, &p.notificationID, &p.userID, &p.token, &p.title, &p.body, &p.attempts,
			&p.notificationType, &p.resourceType, &p.resourceID, &p.reportID, &p.deliveryID,
			&p.sessionOpen, &p.tooOld); err != nil {
			rows.Close()
			return nil, 0, err
		}
		claimed++
		if !p.sessionOpen || p.tooOld {
			gone = append(gone, p.id)
			continue
		}
		leased = append(leased, p.id)
		batch = append(batch, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	if len(gone) > 0 {
		if _, err := tx.Exec(ctx, `DELETE FROM push_outbox WHERE id = ANY($1::uuid[])`, gone); err != nil {
			return nil, 0, err
		}
	}
	if len(leased) > 0 {
		if _, err := tx.Exec(ctx, `UPDATE push_outbox SET next_attempt_at = CURRENT_TIMESTAMP + make_interval(secs => $2)
			WHERE id = ANY($1::uuid[])`, leased, pushLease.Seconds()); err != nil {
			return nil, 0, err
		}
	}
	return batch, claimed, tx.Commit(ctx)
}

// send delivers one claimed push and saves the outcome: sent and dropped pushes leave the outbox, a
// token FCM no longer knows removes its device (and the device's other queued pushes), and anything
// else waits to be retried.
func (w *PushWorker) send(ctx context.Context, p queuedPush) error {
	sendCtx, cancel := context.WithTimeout(ctx, pushSendTimeout)
	err := w.sender.Send(sendCtx, PushMessage{Token: p.token, Title: p.title, Body: p.body, Data: p.data()})
	cancel()
	var permanent permanentError
	switch {
	case err == nil:
		_, err = w.db.Exec(ctx, `DELETE FROM push_outbox WHERE id = $1`, p.id)
	case errors.Is(err, ErrInvalidToken):
		_, err = w.db.Exec(ctx, `DELETE FROM push_devices WHERE token = $1`, p.token)
	case errors.As(err, &permanent) || p.attempts+1 >= pushMaxAttempts:
		slog.Warn("push dropped", "notification", p.notificationID, "attempts", p.attempts+1, "error", err)
		_, err = w.db.Exec(ctx, `DELETE FROM push_outbox WHERE id = $1`, p.id)
	default:
		slog.Warn("push will be retried", "notification", p.notificationID, "attempts", p.attempts+1, "error", err)
		_, err = w.db.Exec(ctx, `UPDATE push_outbox SET attempts = attempts + 1,
			next_attempt_at = CURRENT_TIMESTAMP + make_interval(secs => $2) WHERE id = $1`,
			p.id, backoff(p.attempts+1).Seconds())
	}
	return err
}

// backoff waits 30s, 1m, 2m, 4m, 8m between attempts.
func backoff(attempt int) time.Duration {
	return 30 * time.Second << (attempt - 1)
}

// data is what the app needs to open the notification and check it is the signed-in user's. It
// carries IDs only; the text is in the push itself and the inbox.
func (p queuedPush) data() map[string]string {
	data := map[string]string{"notification_id": p.notificationID, "user_id": p.userID, "type": p.notificationType}
	for key, value := range map[string]*string{
		"resource_type": p.resourceType, "resource_id": p.resourceID,
		"report_id": p.reportID, "delivery_id": p.deliveryID,
	} {
		if value != nil && *value != "" {
			data[key] = *value
		}
	}
	return data
}

// prune forgets devices whose session was revoked or has expired; their queued pushes go with them.
func (w *PushWorker) prune(ctx context.Context) error {
	_, err := w.db.Exec(ctx, `DELETE FROM push_devices pd USING user_sessions s
		WHERE s.id = pd.session_id AND (s.revoked_at IS NOT NULL OR s.expires_at <= CURRENT_TIMESTAMP)`)
	return err
}

// registerDevice records the signed-in session's push token. A token seen before moves to this
// user and session (a shared phone signed in as someone else); the session's older token goes.
func (r *Repository) registerDevice(ctx context.Context, userID, sessionID, token, platform string) error {
	return pgx.BeginFunc(ctx, r.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM push_devices WHERE session_id = $1 AND token <> $2`, sessionID, token); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO push_devices (token, user_id, session_id, platform)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, session_id = EXCLUDED.session_id,
				platform = EXCLUDED.platform, updated_at = CURRENT_TIMESTAMP`, token, userID, sessionID, platform)
		return err
	})
}

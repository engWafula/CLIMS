package reports

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"

	"clims-backend/internal/features/users"
	"clims-backend/internal/pkg/request"
	"clims-backend/internal/pkg/response"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	errVersionScope   = errors.New("approving a report version needs an assigned store or orders:all_stores")
	errCorrectScope   = errors.New("only users with the same scope as the version may correct it")
	errAlreadyCorrect = errors.New("this version has already been corrected; correct the latest version")
)

// Version is an approved report version (RF15, RN04). Status is superseded once a correction replaces it.
type Version struct {
	ID               string            `json:"id"`
	Report           string            `json:"report"`
	Title            string            `json:"title"`
	Period           string            `json:"period"`
	Scope            string            `json:"scope"`
	Filters          map[string]string `json:"filters"`
	StoreID          *string           `json:"store_id"`
	DataUpdatedAt    time.Time         `json:"data_updated_at"`
	ApprovedByID     string            `json:"approved_by_id"`
	ApprovedBy       *string           `json:"approved_by"`
	Note             *string           `json:"note"`
	SupersedesID     *string           `json:"supersedes_id"`
	CorrectionReason *string           `json:"correction_reason"`
	SupersededByID   *string           `json:"superseded_by_id"`
	Status           string            `json:"status"`
	CreatedAt        time.Time         `json:"created_at"`
	Summary          json.RawMessage   `json:"summary,omitempty"`
	Export           *Table            `json:"export,omitempty"`
}

const versionColumns = `v.id, v.report, v.export->>'title', v.export->>'period', v.export->>'scope', v.filters, v.store_id,
	v.data_updated_at, v.approved_by_id, nullif(btrim(concat_ws(' ', u.firstname, u.lastname)), ''), v.note,
	v.supersedes_id, v.correction_reason, n.id, CASE WHEN n.id IS NULL THEN 'approved' ELSE 'superseded' END, v.created_at`

const versionFrom = ` FROM report_versions v JOIN users u ON u.id = v.approved_by_id
	LEFT JOIN report_versions n ON n.supersedes_id = v.id
	WHERE ($1::boolean OR v.store_id = $2::uuid)`

func scanVersion(row pgx.Row, extra ...any) (Version, error) {
	var v Version
	err := row.Scan(append([]any{&v.ID, &v.Report, &v.Title, &v.Period, &v.Scope, &v.Filters, &v.StoreID,
		&v.DataUpdatedAt, &v.ApprovedByID, &v.ApprovedBy, &v.Note, &v.SupersedesID, &v.CorrectionReason,
		&v.SupersededByID, &v.Status, &v.CreatedAt}, extra...)...)
	return v, err
}

// versionStore is the store a user's versions belong to: none for national users, else their store.
func versionStore(s scope) (*string, error) {
	if s.all {
		return nil, nil
	}
	if s.storeID == nil {
		return nil, errVersionScope
	}
	return s.storeID, nil
}

func (r *Repository) versions(ctx context.Context, s scope, report string, limit, offset int32) ([]Version, error) {
	rows, err := r.db.Query(ctx, `SELECT `+versionColumns+versionFrom+` AND ($3 = '' OR v.report = $3)
		ORDER BY v.created_at DESC, v.id DESC LIMIT $4 OFFSET $5`, s.all, s.storeID, report, limit, offset)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Version, error) { return scanVersion(row) })
}

// version loads one version the user may see, with its saved figures and rows, or pgx.ErrNoRows.
func (r *Repository) version(ctx context.Context, s scope, id string) (Version, error) {
	var summary json.RawMessage
	var export Table
	v, err := scanVersion(r.db.QueryRow(ctx, `SELECT `+versionColumns+`, v.summary, v.export`+versionFrom+` AND v.id = $3`,
		s.all, s.storeID, id), &summary, &export)
	v.Summary, v.Export = summary, &export
	return v, err
}

func (r *Repository) saveVersion(ctx context.Context, user *users.User, store *string, summary any, t Table,
	note, supersedes, reason *string) (string, error) {
	var id string
	err := r.db.QueryRow(ctx, `INSERT INTO report_versions (report, filters, store_id, summary, export, data_updated_at,
			approved_by_id, note, supersedes_id, correction_reason)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
		t.Report, t.Filters, store, summary, t, t.DataUpdatedAt, user.ID, note, supersedes, reason).Scan(&id)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return "", errAlreadyCorrect
	}
	return id, err
}

// export downloads a report's rows as calculated now: format=csv, or JSON for the web's Excel export.
func (h *Handler) export(c fiber.Ctx) error {
	p := params(c.Queries())
	format := p["format"]
	delete(p, "format")
	if format != "" && format != "csv" && format != "json" {
		return response.Error(c, 400, "format must be csv or json", nil)
	}
	_, table, err := h.build(c.Context(), users.CurrentUser(c), c.Params("report"), p)
	if err != nil {
		return h.buildError(c, err)
	}
	return sendTable(c, table, format)
}

func sendTable(c fiber.Ctx, t Table, format string) error {
	if format != "csv" {
		return response.Success(c, 200, "", t)
	}
	var buf bytes.Buffer
	buf.Write([]byte{0xEF, 0xBB, 0xBF}) // a byte order mark lets Excel read the CSV as UTF-8
	if err := writeCSV(&buf, t); err != nil {
		slog.Error("CSV export failed", "error", err)
		return response.Error(c, 500, "the export could not be written", nil)
	}
	c.Set(fiber.HeaderContentType, "text/csv; charset=utf-8")
	c.Set(fiber.HeaderContentDisposition, `attachment; filename="clims-`+t.Report+`-`+
		t.DataUpdatedAt.In(Kampala).Format(time.DateOnly)+`.csv"`)
	return c.Send(buf.Bytes())
}

func (h *Handler) buildError(c fiber.Ctx, err error) error {
	var invalid errInvalid
	var internal errInternal
	if errors.As(err, &invalid) && !errors.As(err, &internal) {
		return response.Error(c, 400, err.Error(), nil)
	}
	slog.Error("report build failed", "error", err)
	return response.Error(c, 500, "the report could not be calculated", nil)
}

// VersionInput approves a report as calculated now for the given filters.
type VersionInput struct {
	Report  string            `json:"report"`
	Filters map[string]string `json:"filters"`
	Note    string            `json:"note"`
}

func (h *Handler) createVersion(c fiber.Ctx) error {
	var in VersionInput
	if err := request.DecodeJSON(c, &in); err != nil {
		return response.Error(c, 400, "invalid request body", nil)
	}
	in.Note = strings.TrimSpace(in.Note)
	if len(in.Note) > 1000 {
		return response.Error(c, 422, "note must be at most 1000 characters", nil)
	}
	user := users.CurrentUser(c)
	s, err := h.repo.scopeFor(c.Context(), user)
	if err != nil {
		return response.Error(c, 500, "the version could not be saved", nil)
	}
	store, err := versionStore(s)
	if err != nil {
		return response.Error(c, 403, err.Error(), nil)
	}
	if in.Filters == nil {
		in.Filters = map[string]string{}
	}
	summary, table, err := h.build(c.Context(), user, in.Report, params(in.Filters))
	if err != nil {
		return h.buildError(c, err)
	}
	var note *string
	if in.Note != "" {
		note = &in.Note
	}
	return h.saved(c, s, user, store, summary, table, note, nil, nil)
}

// correctVersion recalculates a version from its saved filters and saves the result as a correction
// with its reason; the corrected version is kept as it was (RN04).
func (h *Handler) correctVersion(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	var in struct {
		Reason string `json:"reason"`
	}
	if err := request.DecodeJSON(c, &in); err != nil {
		return response.Error(c, 400, "invalid request body", nil)
	}
	in.Reason = strings.TrimSpace(in.Reason)
	if in.Reason == "" || len(in.Reason) > 1000 {
		return response.Error(c, 422, "give a correction reason of at most 1000 characters", nil)
	}
	user := users.CurrentUser(c)
	s, err := h.repo.scopeFor(c.Context(), user)
	if err != nil {
		return response.Error(c, 500, "the version could not be corrected", nil)
	}
	old, err := h.repo.version(c.Context(), s, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return response.Error(c, 404, "report version not found", nil)
	} else if err != nil {
		slog.Error("loading report version failed", "error", err)
		return response.Error(c, 500, "the version could not be corrected", nil)
	}
	store, err := versionStore(s)
	if err != nil || (store == nil) != (old.StoreID == nil) || (store != nil && *store != *old.StoreID) {
		return response.Error(c, 403, errCorrectScope.Error(), nil)
	}
	if old.SupersededByID != nil {
		return response.Error(c, 409, errAlreadyCorrect.Error(), nil)
	}
	summary, table, err := h.build(c.Context(), user, old.Report, params(old.Filters))
	if err != nil {
		return h.buildError(c, err)
	}
	return h.saved(c, s, user, store, summary, table, nil, &old.ID, &in.Reason)
}

func (h *Handler) saved(c fiber.Ctx, s scope, user *users.User, store *string, summary any, t Table,
	note, supersedes, reason *string) error {
	id, err := h.repo.saveVersion(c.Context(), user, store, summary, t, note, supersedes, reason)
	if errors.Is(err, errAlreadyCorrect) {
		return response.Error(c, 409, err.Error(), nil)
	} else if err != nil {
		slog.Error("saving report version failed", "error", err)
		return response.Error(c, 500, "the version could not be saved", nil)
	}
	v, err := h.repo.version(c.Context(), s, id)
	if err != nil {
		slog.Error("loading report version failed", "error", err)
		return response.Error(c, 500, "the version was saved but could not be loaded", nil)
	}
	return response.Success(c, 201, "report version approved", v)
}

func (h *Handler) listVersions(c fiber.Ctx) error {
	p := params(c.Queries())
	limit, offset, err := page(p)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	s, err := h.repo.scopeFor(c.Context(), users.CurrentUser(c))
	if err != nil {
		return response.Error(c, 500, "the versions could not be loaded", nil)
	}
	versions, err := h.repo.versions(c.Context(), s, p.get("report"), limit, offset)
	if err != nil {
		slog.Error("listing report versions failed", "error", err)
		return response.Error(c, 500, "the versions could not be loaded", nil)
	}
	return response.Success(c, 200, "", versions)
}

// getVersion returns one version with its saved figures and rows; ?format=csv downloads the rows.
func (h *Handler) getVersion(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	s, err := h.repo.scopeFor(c.Context(), users.CurrentUser(c))
	if err != nil {
		return response.Error(c, 500, "the version could not be loaded", nil)
	}
	v, err := h.repo.version(c.Context(), s, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return response.Error(c, 404, "report version not found", nil)
	} else if err != nil {
		slog.Error("loading report version failed", "error", err)
		return response.Error(c, 500, "the version could not be loaded", nil)
	}
	if format := c.Query("format"); format != "" {
		if format != "csv" && format != "json" {
			return response.Error(c, 400, "format must be csv or json", nil)
		}
		return sendTable(c, *v.Export, format)
	}
	return response.Success(c, 200, "", v)
}

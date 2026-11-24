package reports

import (
	"context"
	"errors"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"clims-backend/internal/features/rbac"
	"clims-backend/internal/features/users"
	"clims-backend/internal/pkg/request"
	"clims-backend/internal/pkg/response"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgconn"
)

type Handler struct {
	repo *Repository
	now  func() time.Time
}

func RegisterRoutes(router fiber.Router, repo *Repository, jwt, activeUser fiber.Handler) {
	h := &Handler{repo: repo, now: time.Now}
	group := router.Group("/reports", jwt, activeUser, rbac.RequirePermission("reports:read"))
	group.Get("/notifications", h.notificationSummary)
	group.Get("/notifications/records", h.notificationRecords)
	group.Get("/warehouse-requests", h.supply)
	group.Get("/warehouse-requests/records", h.supplyRecords)
	group.Get("/stock", h.stock)
	group.Get("/batches", h.batches)
	group.Get("/expiry-exceptions", h.expiryExceptions)
	group.Get("/settings", h.settings)
	group.Post("/settings", rbac.RequirePermission("reports:configure"), h.saveSettings)
	group.Get("/hmis-105", h.hmis)
	group.Get("/trends", h.trends)
	group.Get("/hotspots", h.hotspots)
	group.Get("/export/:report", h.export)
	group.Get("/versions", h.listVersions)
	group.Post("/versions", rbac.RequirePermission("reports:approve"), h.createVersion)
	group.Get("/versions/:id", h.getVersion)
	group.Post("/versions/:id/corrections", rbac.RequirePermission("reports:approve"), h.correctVersion)
}

// settings returns the response settings in effect for a store (store_id) or nationally, with the
// history of that scope.
func (h *Handler) settings(c fiber.Ctx) error {
	p := params(c.Queries())
	s, err := h.repo.scopeFor(c.Context(), users.CurrentUser(c))
	if err != nil {
		return response.Error(c, 500, "the settings could not be loaded", nil)
	}
	var storeID *string
	if raw := p.get("store_id"); raw != "" {
		id, err := request.ParseUUID(raw)
		if err != nil {
			return response.Error(c, 400, "store_id must be a UUID", nil)
		}
		if !s.all && (s.storeID == nil || *s.storeID != id) {
			return response.Error(c, 403, errSettingsScope.Error(), nil)
		}
		storeID = &id
	}
	effective, err := h.repo.effectiveSettings(c.Context(), storeID, h.today())
	if err != nil {
		slog.Error("settings failed", "error", err)
		return response.Error(c, 500, "the settings could not be loaded", nil)
	}
	history, err := h.repo.settingsHistory(c.Context(), storeID)
	if err != nil {
		slog.Error("settings history failed", "error", err)
		return response.Error(c, 500, "the settings could not be loaded", nil)
	}
	return response.Success(c, 200, "", fiber.Map{"effective": effective, "history": history})
}

// saveSettings adds a setting taking effect from a date (RF07). A store may change only its own
// targets, and national targets need orders:all_stores (RN11).
func (h *Handler) saveSettings(c fiber.Ctx) error {
	var in SettingsInput
	if err := request.DecodeJSON(c, &in); err != nil {
		return response.Error(c, 400, "invalid request body", nil)
	}
	if in.StoreID != nil {
		id, err := request.ParseUUID(*in.StoreID)
		if err != nil {
			return response.Error(c, 422, "store_id must be a UUID, or null for national settings", nil)
		}
		in.StoreID = &id
	}
	in.Reason = strings.TrimSpace(in.Reason)
	switch {
	case !ValidCycle(in.ReviewCycle):
		return response.Error(c, 422, "review_cycle must be weekly, monthly, bimonthly or quarterly", nil)
	case in.DeadlineDays < 1 || in.DeadlineDays > 365:
		return response.Error(c, 422, "deadline_days must be between 1 and 365", nil)
	case in.TargetPercent < 1 || in.TargetPercent > 100:
		return response.Error(c, 422, "target_percent must be between 1 and 100", nil)
	case in.Reason == "" || len(in.Reason) > 1000:
		return response.Error(c, 422, "give a reason of at most 1000 characters", nil)
	}
	effective := h.today()
	if in.EffectiveFrom != nil {
		day, err := time.ParseInLocation(time.DateOnly, *in.EffectiveFrom, Kampala)
		if err != nil {
			return response.Error(c, 422, "effective_from must be a YYYY-MM-DD date", nil)
		}
		if day.Before(effective) {
			return response.Error(c, 422, errPastEffective.Error(), nil)
		}
		effective = day
	}
	user := users.CurrentUser(c)
	all := user.HasPermission("orders:all_stores")
	if !all && (in.StoreID == nil || user.StoreID == nil || *user.StoreID != *in.StoreID) {
		return response.Error(c, 403, errSettingsScope.Error(), nil)
	}
	saved, err := h.repo.saveSettings(c.Context(), in, effective, user.ID)
	var dbError *pgconn.PgError
	if errors.As(err, &dbError) && dbError.Code == "23503" {
		return response.Error(c, 422, "store_id does not name a store", nil)
	}
	if err != nil {
		slog.Error("saving settings failed", "error", err)
		return response.Error(c, 500, "the settings could not be saved", nil)
	}
	return response.Success(c, 201, "settings saved; they apply from effective_from", saved)
}

// hmis prepares HMIS 105 condom figures for a month (month=YYYY-MM, default the current month).
func (h *Handler) hmis(c fiber.Ctx) error {
	month, district, err := h.hmisFilter(params(c.Queries()))
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	s, err := h.repo.scopeFor(c.Context(), users.CurrentUser(c))
	if err != nil {
		return response.Error(c, 500, "the report could not be calculated", nil)
	}
	report, err := h.repo.hmisReadiness(c.Context(), s, month, district, h.now())
	if err != nil {
		slog.Error("HMIS readiness failed", "error", err)
		return response.Error(c, 500, "the report could not be calculated", nil)
	}
	return response.Success(c, 200, "", report)
}

// hmisFilter reads month=YYYY-MM (default the current month) and an optional district_id.
func (h *Handler) hmisFilter(p params) (time.Time, *string, error) {
	today := h.today()
	month := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, Kampala)
	if raw := p.get("month"); raw != "" {
		parsed, err := time.ParseInLocation("2006-01", raw, Kampala)
		if err != nil {
			return time.Time{}, nil, errors.New("month must be YYYY-MM")
		}
		month = parsed
	}
	var district *string
	if raw := p.get("district_id"); raw != "" {
		id, err := request.ParseUUID(raw)
		if err != nil {
			return time.Time{}, nil, errors.New("district_id must be a UUID")
		}
		district = &id
	}
	return month, district, nil
}

// params are a report's query parameters, from the request or from a saved report version.
type params map[string]string

func (p params) get(key string, fallback ...string) string {
	if v := p[key]; v != "" || len(fallback) == 0 {
		return v
	}
	return fallback[0]
}

// today is the current Kampala calendar day.
func (h *Handler) today() time.Time {
	t := h.now().In(Kampala)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, Kampala)
}

var bands = map[string]bool{"": true, "expired": true, "under_1_month": true, "under_3_months": true,
	"under_6_months": true, "ok": true, "unknown": true}

func (h *Handler) batches(c fiber.Ctx) error {
	f, s, err := h.supplyFilter(c.Context(), users.CurrentUser(c), params(c.Queries()))
	if err != nil {
		return filterError(c, err)
	}
	band := c.Query("band")
	if !bands[band] {
		return response.Error(c, 400, "band must be expired, under_1_month, under_3_months, under_6_months, ok or unknown", nil)
	}
	report, err := h.repo.batchReport(c.Context(), s, f, band, h.now())
	if err != nil {
		slog.Error("batch report failed", "error", err)
		return response.Error(c, 500, "the report could not be calculated", nil)
	}
	return response.Success(c, 200, "", report)
}

func (h *Handler) expiryExceptions(c fiber.Ctx) error {
	f, s, err := h.supplyFilter(c.Context(), users.CurrentUser(c), params(c.Queries()))
	if err != nil {
		return filterError(c, err)
	}
	if f.Limit, f.Offset, err = page(params(c.Queries())); err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	exceptions, err := h.repo.expiryExceptions(c.Context(), s, f)
	if err != nil {
		slog.Error("expiry exceptions failed", "error", err)
		return response.Error(c, 500, "the exceptions could not be loaded", nil)
	}
	return response.Success(c, 200, "", exceptions)
}

// supplyFilter reads the period and category as the notification reports do, plus the store filters.
func (h *Handler) supplyFilter(ctx context.Context, user *users.User, p params) (SupplyFilter, scope, error) {
	base, err := ParseFilter(p.get("from"), p.get("to"), p.get("category"), "7", "80", h.now())
	if err != nil {
		return SupplyFilter{}, scope{}, err
	}
	f := SupplyFilter{Filter: base, StoreType: p.get("store_type")}
	if f.StoreType != "" && f.StoreType != "national" && f.StoreType != "district" {
		return SupplyFilter{}, scope{}, errors.New("store_type must be national or district")
	}
	for name, dst := range map[string]**string{"district_id": &f.DistrictID, "warehouse_store_id": &f.WarehouseID, "store_id": &f.StoreID} {
		if raw := p.get(name); raw != "" {
			id, err := request.ParseUUID(raw)
			if err != nil {
				return SupplyFilter{}, scope{}, errors.New(name + " must be a UUID")
			}
			*dst = &id
		}
	}
	s, err := h.repo.scopeFor(ctx, user)
	if err != nil {
		return SupplyFilter{}, scope{}, errInternal{err}
	}
	return f, s, nil
}

// errInternal marks a failure on our side while reading a report's filters (the user's scope, a
// district's store, the saved settings), so it is logged and answered 500 rather than shown as a 400.
type errInternal struct{ error }

func (e errInternal) Unwrap() error { return e.error }

// filterError answers a filter that could not be read: 400 with the reason when the request was wrong,
// 500 when the database failed.
func filterError(c fiber.Ctx, err error) error {
	var internal errInternal
	if errors.As(err, &internal) {
		slog.Error("report filters could not be read", "error", err)
		return response.Error(c, 500, "the report could not be calculated", nil)
	}
	return response.Error(c, 400, err.Error(), nil)
}

func (h *Handler) supply(c fiber.Ctx) error {
	f, s, err := h.supplyFilter(c.Context(), users.CurrentUser(c), params(c.Queries()))
	if err != nil {
		return filterError(c, err)
	}
	report, err := h.repo.supplyReport(c.Context(), s, f, h.now())
	if err != nil {
		slog.Error("warehouse request report failed", "error", err)
		return response.Error(c, 500, "the report could not be calculated", nil)
	}
	return response.Success(c, 200, "", report)
}

func (h *Handler) supplyRecords(c fiber.Ctx) error {
	f, s, err := h.supplyFilter(c.Context(), users.CurrentUser(c), params(c.Queries()))
	if err != nil {
		return filterError(c, err)
	}
	if f.Limit, f.Offset, err = page(params(c.Queries())); err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	records, err := h.repo.requestRecords(c.Context(), s, f)
	if err != nil {
		slog.Error("warehouse request records failed", "error", err)
		return response.Error(c, 500, "the records could not be loaded", nil)
	}
	return response.Success(c, 200, "", records)
}

func (h *Handler) stock(c fiber.Ctx) error {
	f, s, err := h.supplyFilter(c.Context(), users.CurrentUser(c), params(c.Queries()))
	if err != nil {
		return filterError(c, err)
	}
	report, err := h.repo.stockReport(c.Context(), s, f, h.now())
	if err != nil {
		slog.Error("stock report failed", "error", err)
		return response.Error(c, 500, "the report could not be calculated", nil)
	}
	return response.Success(c, 200, "", report)
}

// trends returns each measure per day, week or month over a period (default the last six months to
// date), with the warehouse request filters.
func (h *Handler) trends(c fiber.Ctx) error {
	p := params(c.Queries())
	if p.get("from") == "" {
		// Six calendar months to date, ending on `to` when it is given.
		end := h.today()
		if day, err := time.ParseInLocation(time.DateOnly, p.get("to"), Kampala); err == nil {
			end = day
		}
		p["from"] = time.Date(end.Year(), end.Month()-5, 1, 0, 0, 0, 0, Kampala).Format(time.DateOnly)
	}
	f, s, err := h.supplyFilter(c.Context(), users.CurrentUser(c), p)
	if err != nil {
		return filterError(c, err)
	}
	if raw := p.get("hot_spot_id"); raw != "" {
		id, err := request.ParseUUID(raw)
		if err != nil {
			return response.Error(c, 400, "hot_spot_id must be a UUID", nil)
		}
		f.HotSpotID = &id
	}
	interval := p.get("interval", DefaultInterval(f.From, f.To))
	if _, err := TrendBuckets(f.From, f.To, interval); err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	report, err := h.repo.trendReport(c.Context(), s, f, interval, h.now())
	if err != nil {
		slog.Error("trend report failed", "error", err)
		return response.Error(c, 500, "the report could not be calculated", nil)
	}
	return response.Success(c, 200, "", report)
}

// hotspots reports hotspot coverage: every hotspot for national users (orders:all_stores or
// hotspots:all_districts), else the district the user works in. region_id and district_id narrow it.
func (h *Handler) hotspots(c fiber.Ctx) error {
	user := users.CurrentUser(c)
	var f HotspotFilter
	for name, dst := range map[string]**string{"region_id": &f.RegionID, "district_id": &f.DistrictID} {
		if raw := c.Query(name); raw != "" {
			id, err := request.ParseUUID(raw)
			if err != nil {
				return response.Error(c, 400, name+" must be a UUID", nil)
			}
			*dst = &id
		}
	}
	all := user.HasPermission("orders:all_stores") || user.HasPermission("hotspots:all_districts")
	var district *string
	if !all {
		var err error
		if district, err = h.repo.userDistrict(c.Context(), user.ID); err != nil {
			slog.Error("hotspot report scope failed", "error", err)
			return response.Error(c, 500, "the report could not be calculated", nil)
		}
		if district == nil {
			return response.Error(c, 403, "the hotspot report covers the district you work in, and your account has none; ask an administrator to assign your store", nil)
		}
	}
	report, err := h.repo.hotspotReport(c.Context(), all, district, f, h.now())
	if err != nil {
		slog.Error("hotspot report failed", "error", err)
		return response.Error(c, 500, "the report could not be calculated", nil)
	}
	return response.Success(c, 200, "", report)
}

// page reads a list's limit (default 50, at most 100) and offset (default 0).
func page(p params) (int32, int32, error) {
	limit, limitErr := strconv.ParseInt(p.get("limit", "50"), 10, 32)
	offset, offsetErr := strconv.ParseInt(p.get("offset", "0"), 10, 32)
	if limitErr != nil || offsetErr != nil || limit < 1 || limit > 100 || offset < 0 {
		return 0, 0, errors.New("limit must be between 1 and 100 and offset must be nonnegative")
	}
	return int32(limit), int32(offset), nil
}

func (h *Handler) notificationSummary(c fiber.Ctx) error {
	f, s, settings, err := h.filter(c.Context(), users.CurrentUser(c), params(c.Queries()))
	if err != nil {
		return filterError(c, err)
	}
	summary, err := h.repo.notificationSummary(c.Context(), s, f, h.now())
	if err != nil {
		slog.Error("notification report failed", "error", err)
		return response.Error(c, 500, "the report could not be calculated", nil)
	}
	summary.Settings = settings
	return response.Success(c, 200, "", summary)
}

func (h *Handler) notificationRecords(c fiber.Ctx) error {
	f, s, _, err := h.filter(c.Context(), users.CurrentUser(c), params(c.Queries()))
	if err != nil {
		return filterError(c, err)
	}
	f.Status = c.Query("status")
	switch f.Status {
	case "", "fulfilled", "partly_received", "awaiting_acknowledgement", "awaiting_supply", "rejected":
	default:
		return response.Error(c, 400, "status must be fulfilled, partly_received, awaiting_acknowledgement, awaiting_supply or rejected", nil)
	}
	if f.Limit, f.Offset, err = page(params(c.Queries())); err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	records, err := h.repo.notificationRecords(c.Context(), s, f)
	if err != nil {
		slog.Error("notification records failed", "error", err)
		return response.Error(c, 500, "the records could not be loaded", nil)
	}
	return response.Success(c, 200, "", records)
}

// filter reads the period, geography and product shared by every notification report, the user's
// scope, and the response settings in effect (RF07): those of the filtered district's store, else the
// user's store, else national. Without from and to the period is the current review cycle to date;
// deadline_days and target_percent override the saved targets for ad hoc analysis.
func (h *Handler) filter(ctx context.Context, user *users.User, p params) (Filter, scope, ResponseSettings, error) {
	fail := func(err error) (Filter, scope, ResponseSettings, error) {
		return Filter{}, scope{}, ResponseSettings{}, err
	}
	ids := map[string]*string{}
	for _, name := range []string{"district_id", "hot_spot_id"} {
		if raw := p.get(name); raw != "" {
			id, err := request.ParseUUID(raw)
			if err != nil {
				return fail(errors.New(name + " must be a UUID"))
			}
			ids[name] = &id
		}
	}
	s, err := h.repo.scopeFor(ctx, user)
	if err != nil {
		return fail(errInternal{err})
	}
	store := s.storeID
	if ids["district_id"] != nil {
		if store, err = h.repo.districtStore(ctx, *ids["district_id"]); err != nil {
			return fail(errInternal{err})
		}
	}
	settings, err := h.repo.effectiveSettings(ctx, store, h.today())
	if err != nil {
		return fail(errInternal{err})
	}
	from, to := p.get("from"), p.get("to")
	if from == "" {
		// The review cycle to date, or the cycle that holds `to`; a bad `to` fails in ParseFilter.
		anchor := h.now()
		if day, err := time.ParseInLocation(time.DateOnly, to, Kampala); err == nil {
			anchor = day
		}
		from = CycleStart(settings.ReviewCycle, anchor).Format(time.DateOnly)
	}
	f, err := ParseFilter(from, to, p.get("category"), p.get("deadline_days", strconv.Itoa(settings.DeadlineDays)),
		p.get("target_percent", strconv.Itoa(settings.TargetPercent)), h.now())
	if err != nil {
		return fail(err)
	}
	f.DistrictID, f.HotSpotID = ids["district_id"], ids["hot_spot_id"]
	return f, s, settings, nil
}

// ParseFilter reads a report period as Kampala calendar days, both included, defaulting to the
// current month to date (or, given only `to`, its month up to `to`), with the product filter and the
// deadline settings.
func ParseFilter(from, to, category, deadlineDays, target string, now time.Time) (Filter, error) {
	today := now.In(Kampala)
	day := func(raw string, fallback time.Time) (time.Time, error) {
		if raw == "" {
			return fallback, nil
		}
		parsed, err := time.ParseInLocation(time.DateOnly, raw, Kampala)
		if err != nil {
			return time.Time{}, errors.New("from and to must be YYYY-MM-DD dates")
		}
		return parsed, nil
	}
	var f Filter
	end, err := day(to, time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, Kampala))
	if err != nil {
		return Filter{}, err
	}
	start, err := day(from, time.Date(end.Year(), end.Month(), 1, 0, 0, 0, 0, Kampala))
	if err != nil {
		return Filter{}, err
	}
	if end.Before(start) {
		return Filter{}, errors.New("from must not be after to")
	}
	f.From, f.To = start, end.AddDate(0, 0, 1)
	switch category {
	case "", "male", "female":
		f.Category = category
	default:
		return Filter{}, errors.New("category must be male or female")
	}
	if f.DeadlineDays, err = strconv.Atoi(deadlineDays); err != nil || f.DeadlineDays < 1 || f.DeadlineDays > 365 {
		return Filter{}, errors.New("deadline_days must be between 1 and 365")
	}
	if f.Target, err = strconv.Atoi(target); err != nil || f.Target < 1 || f.Target > 100 {
		return Filter{}, errors.New("target_percent must be between 1 and 100")
	}
	return f, nil
}

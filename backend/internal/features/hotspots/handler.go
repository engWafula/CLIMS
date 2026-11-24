package hotspots

import (
	"errors"
	"log/slog"
	"slices"
	"strconv"

	"clims-backend/internal/features/users"
	"clims-backend/internal/pkg/request"
	"clims-backend/internal/pkg/response"
	"clims-backend/internal/pkg/validator"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type Handler struct {
	repo *Repository
}

func scopeFor(user *users.User) scope {
	return scope{
		userID:       user.ID,
		storeID:      user.StoreID,
		submit:       user.HasPermission("hotspots:submit"),
		activate:     user.HasPermission("hotspots:activate"),
		readDistrict: user.HasPermission("hotspots:read_district"),
		allDistricts: user.HasPermission("hotspots:all_districts"),
	}
}

func pagination(c fiber.Ctx) (int32, int32, bool) {
	limit, limitErr := strconv.ParseInt(c.Query("limit", "50"), 10, 32)
	offset, offsetErr := strconv.ParseInt(c.Query("offset", "0"), 10, 32)
	if limitErr != nil || offsetErr != nil || limit < 1 || limit > 100 || offset < 0 {
		return 0, 0, false
	}
	return int32(limit), int32(offset), true
}

func (h *Handler) list(c fiber.Ctx) error {
	limit, offset, ok := pagination(c)
	if !ok {
		return response.Error(c, 400, "limit must be between 1 and 100 and offset must be nonnegative", nil)
	}
	filter := Filter{Status: c.Query("status"), ReviewStatus: c.Query("review_status")}
	if !slices.Contains([]string{"", StatusActive, StatusInactive}, filter.Status) {
		return response.Error(c, 400, "status must be active or inactive", nil)
	}
	if !slices.Contains([]string{"", ReviewSubmitted, ReviewRejected, ReviewActive, ReviewDeactivated}, filter.ReviewStatus) {
		return response.Error(c, 400, "review_status must be submitted, rejected, active or deactivated", nil)
	}
	for name, target := range map[string]**string{"submitted_by_id": &filter.SubmittedByID, "district_id": &filter.DistrictID} {
		if raw := c.Query(name); raw != "" {
			id, err := request.ParseUUID(raw)
			if err != nil {
				return response.Error(c, 400, name+" must be a nonzero UUID", nil)
			}
			*target = &id
		}
	}
	hotSpots, err := h.repo.list(c.Context(), scopeFor(users.CurrentUser(c)), filter, limit, offset)
	if err != nil {
		return hotSpotError(c, err)
	}
	return response.Success(c, 200, "hotspots retrieved", hotSpots)
}

func (h *Handler) get(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	return h.respondWithDetail(c, 200, "hotspot retrieved", id)
}

func (h *Handler) submit(c fiber.Ctx) error {
	var input SubmitRequest
	if err := request.DecodeJSON(c, &input); err != nil {
		return response.Error(c, 400, "invalid request body", err.Error())
	}
	input.Normalize()
	if err := validator.Validate.Struct(input); err != nil {
		return response.Error(c, 422, "validation failed", validator.FormatErrors(err))
	}
	if fields := input.positionErrors(); fields != nil {
		return response.Error(c, 422, "validation failed", fields)
	}
	id, err := h.repo.submit(c.Context(), users.CurrentUser(c).ID, input)
	if err != nil {
		return hotSpotError(c, err)
	}
	return h.respondWithDetail(c, 201, "hotspot submitted for district verification", id)
}

func (h *Handler) update(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	var input Details
	if err = request.DecodeJSON(c, &input); err != nil {
		return response.Error(c, 400, "invalid request body", err.Error())
	}
	input.Normalize()
	if err = validator.Validate.Struct(input); err != nil {
		return response.Error(c, 422, "validation failed", validator.FormatErrors(err))
	}
	if fields := input.positionErrors(); fields != nil {
		return response.Error(c, 422, "validation failed", fields)
	}
	if err = h.repo.update(c.Context(), users.CurrentUser(c).ID, id, input); err != nil {
		return hotSpotError(c, err)
	}
	return h.respondWithDetail(c, 200, "hotspot updated", id)
}

// decodeComment reads the hotspot ID and comment body. On invalid input it writes
// the error response and returns a nil request with that write's result.
func decodeComment(c fiber.Ctx) (string, *CommentRequest, error) {
	id, err := request.UUIDParam(c)
	if err != nil {
		return "", nil, response.Error(c, 400, err.Error(), nil)
	}
	var input CommentRequest
	if err = request.DecodeJSON(c, &input); err != nil {
		return "", nil, response.Error(c, 400, "invalid request body", err.Error())
	}
	input.Normalize()
	if err = validator.Validate.Struct(input); err != nil {
		return "", nil, response.Error(c, 422, "validation failed", validator.FormatErrors(err))
	}
	return id, &input, nil
}

func (h *Handler) comment(c fiber.Ctx) error {
	id, input, err := decodeComment(c)
	if input == nil {
		return err
	}
	if err = h.repo.comment(c.Context(), scopeFor(users.CurrentUser(c)), id, input.Comment); err != nil {
		return hotSpotError(c, err)
	}
	return h.respondWithDetail(c, 201, "comment added", id)
}

// decision returns the handler for a DCFP decision such as activate.
func (h *Handler) decision(action, message string) fiber.Handler {
	return func(c fiber.Ctx) error {
		id, input, err := decodeComment(c)
		if input == nil {
			return err
		}
		if err = h.repo.decide(c.Context(), scopeFor(users.CurrentUser(c)), id, action, input.Comment); err != nil {
			return hotSpotError(c, err)
		}
		return h.respondWithDetail(c, 200, message, id)
	}
}

func (h *Handler) events(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	events, err := h.repo.events(c.Context(), scopeFor(users.CurrentUser(c)), id)
	if err != nil {
		return hotSpotError(c, err)
	}
	return response.Success(c, 200, "hotspot events retrieved", events)
}

func (h *Handler) notifications(c fiber.Ctx) error {
	limit, offset, ok := pagination(c)
	if !ok {
		return response.Error(c, 400, "limit must be between 1 and 100 and offset must be nonnegative", nil)
	}
	events, err := h.repo.notifications(c.Context(), scopeFor(users.CurrentUser(c)), limit, offset)
	if err != nil {
		return hotSpotError(c, err)
	}
	return response.Success(c, 200, "hotspot notifications retrieved", events)
}

func (h *Handler) respondWithDetail(c fiber.Ctx, status int, message, id string) error {
	detail, err := h.repo.get(c.Context(), scopeFor(users.CurrentUser(c)), id)
	if err != nil {
		return hotSpotError(c, err)
	}
	return response.Success(c, status, message, detail)
}

func hotSpotError(c fiber.Ctx, err error) error {
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return response.Error(c, 404, "hotspot not found", nil)
	case errors.Is(err, ErrInvalidLocation):
		return response.Error(c, 422, err.Error(), nil)
	case errors.Is(err, ErrDuplicateName), errors.Is(err, ErrNotEditable), errors.Is(err, ErrInvalidTransition),
		errors.Is(err, ErrDistrictLocked):
		return response.Error(c, 409, err.Error(), nil)
	}
	var dbError *pgconn.PgError
	if errors.As(err, &dbError) && dbError.Code == "23503" {
		return response.Error(c, 422, "a referenced region, district, subcounty or user does not exist", nil)
	}
	slog.Error("hotspot operation failed", "error", err)
	return response.Error(c, 500, "hotspot operation failed", nil)
}

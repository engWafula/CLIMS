package users

import (
	"errors"
	"log/slog"
	"strconv"

	"clims-backend/internal/pkg/request"
	"clims-backend/internal/pkg/response"
	"clims-backend/internal/pkg/validator"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type Handler struct {
	Repo    *Repository
	Service *Service
}

func NewHandler(repo *Repository, service *Service) *Handler {
	return &Handler{Repo: repo, Service: service}
}

func (h *Handler) createUser(c fiber.Ctx, req AccountInput, roleIDs []string) error {
	id, err := h.Service.CreateWithRoles(c.Context(), req, roleIDs)
	if errors.Is(err, ErrUnknownRole) {
		return response.Error(c, 422, "unknown role_id", nil)
	}
	if errors.Is(err, ErrHashPassword) {
		return response.Error(c, 500, "failed to hash password", nil)
	}
	if errors.Is(err, ErrUnknownStore) {
		return response.Error(c, 422, "validation failed", map[string]string{"store_id": "Choose an existing store."})
	}
	if err != nil {
		if message, ok := DuplicateIdentifier(err); ok {
			return response.Error(c, 409, message, nil)
		}
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			switch pgErr.ConstraintName {
			case "users_organisation_unit_id_fkey", "users_hot_spot_id_fkey":
				return response.Error(c, 422, "unknown organisation unit or hot spot", nil)
			}
		}
		return response.Error(c, 500, "failed to create user", nil)
	}
	return response.Success(c, 201, "user registered successfully", fiber.Map{"user_id": id})
}

func (h *Handler) ListUsers(c fiber.Ctx) error {
	limit, offset := 50, 0
	var err error
	if raw := c.Query("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 100 {
			return response.Error(c, 400, "limit must be between 1 and 100", nil)
		}
	}
	if raw := c.Query("offset"); raw != "" {
		offset, err = strconv.Atoi(raw)
		if err != nil || offset < 0 {
			return response.Error(c, 400, "offset must be nonnegative", nil)
		}
	}
	users, err := h.Repo.ListUsers(c.Context(), limit, offset)
	if err != nil {
		return response.Error(c, 500, "failed to list users", nil)
	}
	return response.Success(c, 200, "users retrieved", fiber.Map{"users": users, "limit": limit, "offset": offset})
}

func (h *Handler) GetUser(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	user, err := h.Repo.GetUserByID(c.Context(), id)
	if err != nil {
		return accessError(c, err)
	}
	return response.Success(c, 200, "user retrieved", user)
}

func (h *Handler) CreateUser(c fiber.Ctx) error {
	var req CreateUserRequest
	if err := request.DecodeJSON(c, &req); err != nil {
		return response.Error(c, 400, "invalid request body", err.Error())
	}
	req.AccountInput.Normalize()
	if err := validator.Validate.Struct(req); err != nil {
		return response.Error(c, 422, "validation failed", validator.FormatErrors(err))
	}
	if len(req.Password) > 72 {
		return response.Error(c, 422, "password must not exceed 72 bytes", nil)
	}
	if (req.RoleID == "") == (req.RoleIDs == nil) {
		return response.Error(c, 422, "provide either role_id or role_ids", nil)
	}
	req.AccountInput.Assignment = req.FacilityAssignment
	req.AccountInput.StoreID = req.StoreID
	roleIDs := []string{req.RoleID}
	if req.RoleIDs != nil {
		roleIDs = *req.RoleIDs
	}
	if refused, err := h.refuseAdminChange(c, "", roleIDs); refused {
		return err
	}
	return h.createUser(c, req.AccountInput, roleIDs)
}

func (h *Handler) AssignRole(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	var req AssignRoleRequest
	if err := request.DecodeJSON(c, &req); err != nil {
		return response.Error(c, 400, "invalid request body", err.Error())
	}
	if err := validator.Validate.Struct(req); err != nil {
		return response.Error(c, 422, "validation failed", validator.FormatErrors(err))
	}
	if refused, err := h.refuseAdminChange(c, id, []string{req.RoleID}); refused {
		return err
	}
	if err := h.Repo.UpdateUserAccess(c.Context(), id, &req.RoleID, nil); err != nil {
		return accessError(c, err)
	}
	return response.Success(c, 200, "role assigned", nil)
}

func (h *Handler) SetRoles(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	var req SetRolesRequest
	if err := request.DecodeJSON(c, &req); err != nil {
		return response.Error(c, 400, "invalid request body", err.Error())
	}
	if err := validator.Validate.Struct(req); err != nil {
		return response.Error(c, 422, "validation failed", validator.FormatErrors(err))
	}
	if refused, err := h.refuseAdminChange(c, id, *req.RoleIDs); refused {
		return err
	}
	if err := h.Repo.SetUserRoles(c.Context(), id, *req.RoleIDs); err != nil {
		if errors.Is(err, ErrUnknownRole) {
			return response.Error(c, 422, err.Error(), nil)
		}
		return accessError(c, err)
	}
	return response.Success(c, 200, "user roles updated", nil)
}

func (h *Handler) SetStatus(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	var req UpdateStatusRequest
	if err := request.DecodeJSON(c, &req); err != nil {
		return response.Error(c, 400, "invalid request body", err.Error())
	}
	if err := validator.Validate.Struct(req); err != nil {
		return response.Error(c, 422, "validation failed", validator.FormatErrors(err))
	}
	if refused, err := h.refuseAdminChange(c, id, nil); refused {
		return err
	}
	if err := h.Repo.UpdateUserAccess(c.Context(), id, nil, &req.Status); err != nil {
		return accessError(c, err)
	}
	return response.Success(c, 200, "status updated", nil)
}

// SetStore assigns the store whose orders and stock a user works with; null clears it.
func (h *Handler) SetStore(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	var req SetStoreRequest
	if err = request.DecodeJSON(c, &req); err != nil {
		return response.Error(c, 400, "invalid request body", err.Error())
	}
	if !req.StoreID.Set {
		return response.Error(c, 422, "validation failed", map[string]string{"store_id": "This field is required."})
	}
	var storeID *string
	if req.StoreID.Value != nil {
		parsed, parseErr := request.ParseUUID(*req.StoreID.Value)
		if parseErr != nil {
			return response.Error(c, 422, "validation failed", map[string]string{"store_id": "Choose a valid item from the list."})
		}
		storeID = &parsed
	}
	if refused, refuseErr := h.refuseAdminChange(c, id, nil); refused {
		return refuseErr
	}
	switch err = h.Repo.SetUserStore(c.Context(), id, storeID); {
	case errors.Is(err, pgx.ErrNoRows):
		return response.Error(c, 404, "user not found", nil)
	case errors.Is(err, ErrUnknownStore):
		return response.Error(c, 422, "validation failed", map[string]string{"store_id": "Choose an existing store."})
	case err != nil:
		slog.Error("set user store failed", "error", err)
		return response.Error(c, 500, "failed to update store", nil)
	}
	return response.Success(c, 200, "store updated", nil)
}

func accessError(c fiber.Ctx, err error) error {
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, ErrUnknownRole) {
		return response.Error(c, 404, "user or role not found", nil)
	}
	if errors.Is(err, ErrLastAdmin) {
		return response.Error(c, 409, err.Error(), nil)
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" {
		return response.Error(c, 422, "unknown permission", nil)
	}
	return response.Error(c, 500, "failed to update or retrieve access", nil)
}

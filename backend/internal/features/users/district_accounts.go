package users

import (
	"context"
	"errors"

	"clims-backend/internal/pkg/request"
	"clims-backend/internal/pkg/response"
	"clims-backend/internal/pkg/validator"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"
)

// District focal persons (DCFPs) create the accounts of their district's field workers: VHTs,
// hotspot managers and delivery agents, and only those roles. Everything is fixed to the DCFP's
// own district, as users.DistrictOfUser has it: they cannot name another district, store or role.

// FieldRoles are the roles a DCFP may give, by their server names.
var FieldRoles = []string{"vht", "hotspot manager", "delivery agent"}

func isFieldRole(name string) bool {
	for _, role := range FieldRoles {
		if role == name {
			return true
		}
	}
	return false
}

// DistrictUserRequest is the body of POST /users/district.
type DistrictUserRequest struct {
	AccountInput
	Role string `json:"role" validate:"required"`
	// SubcountyID is required for a VHT: a subcounty in the DCFP's district.
	SubcountyID *string `json:"subcounty_id" validate:"omitempty,uuid_rfc4122"`
	// HotSpotID is required for a hotspot manager: an active hotspot in the DCFP's district.
	HotSpotID *string `json:"hot_spot_id" validate:"omitempty,uuid_rfc4122"`
}

// ErrNoDistrict means the signed-in user has no district: no district store or subcounty.
var ErrNoDistrict = errors.New("your account has no district; ask an administrator to assign your district store")

// districtOf returns the district the user works in.
func (r *Repository) districtOf(ctx context.Context, userID string) (string, error) {
	var district *string
	if err := r.DB.QueryRow(ctx, `SELECT `+DistrictOfUser, userID).Scan(&district); err != nil {
		return "", err
	}
	if district == nil {
		return "", ErrNoDistrict
	}
	return *district, nil
}

// fieldUserWhere limits userSelect to field workers in district $1: holding a field role, and
// working there by their store, their subcounty, or their hotspot.
const fieldUserWhere = `WHERE COALESCE(st.district_id, sc.district_id, h.district_id) = $1::uuid
	AND EXISTS (SELECT 1 FROM role_user fru JOIN roles fr ON fr.id = fru.role_id
		WHERE fru.user_id = u.id AND lower(fr.name) = ANY($2::text[])) `

// ListDistrictUsers returns the field workers in the district, newest first.
func (r *Repository) ListDistrictUsers(ctx context.Context, districtID string) ([]User, error) {
	rows, err := r.DB.Query(ctx, userSelect+fieldUserWhere+`ORDER BY u.created_at DESC, u.id`, districtID, FieldRoles)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := []User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, *u)
	}
	return users, rows.Err()
}

func (r *Repository) roleIDByName(ctx context.Context, name string) (string, error) {
	var id string
	err := r.DB.QueryRow(ctx, `SELECT id FROM roles WHERE lower(name) = $1 ORDER BY id LIMIT 1`, name).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrUnknownRole
	}
	return id, err
}

// subcountyInDistrict reports whether the subcounty lies in the district.
func (r *Repository) subcountyInDistrict(ctx context.Context, subcountyID, districtID string) (bool, error) {
	var ok bool
	err := r.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM subcounties WHERE id = $1::uuid AND district_id = $2::uuid)`,
		subcountyID, districtID).Scan(&ok)
	return ok, err
}

// activeHotSpotInDistrict returns the subcounty of an active hotspot in the district; found is
// false when the hotspot is not one.
func (r *Repository) activeHotSpotInDistrict(ctx context.Context, hotSpotID, districtID string) (subcounty *string, found bool, err error) {
	err = r.DB.QueryRow(ctx, `SELECT subcounty_id FROM hot_spots
		WHERE id = $1::uuid AND district_id = $2::uuid AND status = 'active'`, hotSpotID, districtID).Scan(&subcounty)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	return subcounty, err == nil, err
}

// districtStore returns the district's store, or nil when it has none.
func (r *Repository) districtStore(ctx context.Context, districtID string) (*string, error) {
	var id string
	err := r.DB.QueryRow(ctx, `SELECT id FROM stores WHERE district_id = $1::uuid AND store_type = 'district'
		ORDER BY code LIMIT 1`, districtID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

// callerDistrict is the signed-in user's district, or a response already written when there is none.
func (h *Handler) callerDistrict(c fiber.Ctx) (string, bool, error) {
	caller := CurrentUser(c)
	if caller == nil {
		return "", false, response.Error(c, 401, "unauthorized", nil)
	}
	district, err := h.Repo.districtOf(c.Context(), caller.ID)
	if errors.Is(err, ErrNoDistrict) {
		return "", false, response.Error(c, 403, err.Error(), nil)
	}
	if err != nil {
		return "", false, response.Error(c, 500, "failed to find your district", nil)
	}
	return district, true, nil
}

// ListDistrictUsers is GET /users/district: the field workers in the caller's district.
func (h *Handler) ListDistrictUsers(c fiber.Ctx) error {
	district, ok, err := h.callerDistrict(c)
	if !ok {
		return err
	}
	users, err := h.Repo.ListDistrictUsers(c.Context(), district)
	if err != nil {
		return response.Error(c, 500, "failed to list users", nil)
	}
	return response.Success(c, 200, "users retrieved", fiber.Map{"users": users})
}

// CreateDistrictUser is POST /users/district: a VHT, hotspot manager or delivery agent account in
// the caller's district. A VHT works in a subcounty of it, a hotspot manager runs one of its active
// hotspots, and a delivery agent carries from its district store.
func (h *Handler) CreateDistrictUser(c fiber.Ctx) error {
	var req DistrictUserRequest
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
	if !isFieldRole(req.Role) {
		return response.Error(c, 422, "validation failed",
			map[string]string{"role": "Choose VHT, hotspot manager or delivery agent."})
	}
	district, ok, err := h.callerDistrict(c)
	if !ok {
		return err
	}
	ctx := c.Context()

	// Only the assignment the role needs is kept; anything else sent is ignored.
	input := req.AccountInput
	input.Assignment = FacilityAssignment{}
	input.StoreID, input.SubcountyID = nil, nil
	switch req.Role {
	case "vht":
		if req.SubcountyID == nil {
			return response.Error(c, 422, "validation failed", map[string]string{"subcounty_id": "Choose the VHT's subcounty."})
		}
		inside, err := h.Repo.subcountyInDistrict(ctx, *req.SubcountyID, district)
		if err != nil {
			return response.Error(c, 500, "failed to check the subcounty", nil)
		}
		if !inside {
			return response.Error(c, 422, "validation failed", map[string]string{"subcounty_id": "Choose a subcounty in your district."})
		}
		input.SubcountyID = req.SubcountyID
	case "hotspot manager":
		if req.HotSpotID == nil {
			return response.Error(c, 422, "validation failed", map[string]string{"hot_spot_id": "Choose the hotspot they manage."})
		}
		subcounty, found, err := h.Repo.activeHotSpotInDistrict(ctx, *req.HotSpotID, district)
		if err != nil {
			return response.Error(c, 500, "failed to check the hotspot", nil)
		}
		if !found {
			return response.Error(c, 422, "validation failed", map[string]string{"hot_spot_id": "Choose an active hotspot in your district."})
		}
		input.Assignment.HotSpotID, input.SubcountyID = req.HotSpotID, subcounty
	case "delivery agent":
		store, err := h.Repo.districtStore(ctx, district)
		if err != nil {
			return response.Error(c, 500, "failed to find the district store", nil)
		}
		if store == nil {
			return response.Error(c, 422, "validation failed",
				map[string]string{"role": "Your district has no district store for a delivery agent to carry from."})
		}
		input.StoreID = store
	}

	roleID, err := h.Repo.roleIDByName(ctx, req.Role)
	if errors.Is(err, ErrUnknownRole) {
		return response.Error(c, 422, "validation failed", map[string]string{"role": "That role does not exist on this server."})
	}
	if err != nil {
		return response.Error(c, 500, "failed to create user", nil)
	}
	return h.createUser(c, input, []string{roleID})
}

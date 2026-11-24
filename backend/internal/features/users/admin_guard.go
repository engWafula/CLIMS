package users

import (
	"context"
	"errors"
	"log/slog"

	"clims-backend/internal/features/rbac"
	"clims-backend/internal/pkg/response"

	"github.com/gofiber/fiber/v3"
)

// errAdminOnly refuses a caller who is not an administrator but would hand out the administrator role
// or change an administrator's account. Administrators can grant users:update, users:create and
// roles:assign to other roles; without this, such a role could make itself administrator or lock the
// administrators out.
var errAdminOnly = errors.New("only an administrator can give the administrator role or change an administrator's account")

// holdsAdmin reports whether user holds the administrator role.
func holdsAdmin(user *User) bool {
	if user == nil {
		return false
	}
	if user.Role != nil && user.Role.Name == rbac.AdminRoleName {
		return true
	}
	for _, role := range user.Roles {
		if role.Name == rbac.AdminRoleName {
			return true
		}
	}
	return false
}

// touchesAdmin reports whether roleIDs include the administrator role or targetID ("" for none) holds it.
func (r *Repository) touchesAdmin(ctx context.Context, targetID string, roleIDs []string) (bool, error) {
	if roleIDs == nil {
		roleIDs = []string{}
	}
	var touches bool
	err := r.DB.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM roles r WHERE r.name = $1 AND (r.id::text = ANY($2::text[])
			OR EXISTS (SELECT 1 FROM role_user ru WHERE ru.role_id = r.id AND ru.user_id::text = $3)))`,
		rbac.AdminRoleName, roleIDs, targetID).Scan(&touches)
	return touches, err
}

// refuseAdminChange answers 403 when a caller who is not an administrator would give the administrator
// role (roleIDs) or change an administrator's account (targetID). It returns true once it has answered.
func (h *Handler) refuseAdminChange(c fiber.Ctx, targetID string, roleIDs []string) (bool, error) {
	if holdsAdmin(CurrentUser(c)) {
		return false, nil
	}
	touches, err := h.Repo.touchesAdmin(c.Context(), targetID, roleIDs)
	if err != nil {
		slog.Error("administrator check failed", "error", err)
		return true, response.Error(c, 500, "failed to check access", nil)
	}
	if touches {
		return true, response.Error(c, 403, errAdminOnly.Error(), nil)
	}
	return false, nil
}

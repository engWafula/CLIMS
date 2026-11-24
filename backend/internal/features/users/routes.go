package users

import (
	"clims-backend/internal/features/rbac"

	"github.com/gofiber/fiber/v3"
)

func RegisterRoutes(router fiber.Router, handler *Handler, jwtMiddleware, activeUser fiber.Handler) {
	users := router.Group("/users", jwtMiddleware, activeUser)
	users.Get("/", rbac.RequirePermission("users:read"), handler.ListUsers)
	// Registered before /:id so "district" is not read as a user ID.
	users.Get("/district", rbac.RequirePermission("users:district_read"), handler.ListDistrictUsers)
	users.Post("/district", rbac.RequirePermission("users:district_create"), handler.CreateDistrictUser)
	users.Get("/:id", rbac.RequirePermission("users:read"), handler.GetUser)
	users.Post("/", rbac.RequirePermission("users:create"), rbac.RequirePermission("roles:assign"), handler.CreateUser)
	users.Patch("/:id/role", rbac.RequirePermission("roles:assign"), handler.AssignRole)
	users.Put("/:id/roles", rbac.RequirePermission("roles:assign"), handler.SetRoles)
	users.Patch("/:id/status", rbac.RequirePermission("users:update"), handler.SetStatus)
	users.Patch("/:id/store", rbac.RequirePermission("users:update"), handler.SetStore)
	users.Get("/:id/sessions", rbac.RequirePermission("users:read"), handler.UserSessions)
	users.Delete("/:id/sessions", rbac.RequirePermission("users:update"), handler.RevokeUserSessions)
}

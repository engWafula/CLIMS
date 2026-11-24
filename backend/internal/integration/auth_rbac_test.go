package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"clims-backend/internal/database"
	"clims-backend/internal/features/audit"
	"clims-backend/internal/features/auth"
	"clims-backend/internal/features/catalogue"
	"clims-backend/internal/features/hotspots"
	"clims-backend/internal/features/inventory"
	"clims-backend/internal/features/locations"
	"clims-backend/internal/features/notifications"
	"clims-backend/internal/features/orders"
	"clims-backend/internal/features/rbac"
	"clims-backend/internal/features/reports"
	"clims-backend/internal/features/users"
	"clims-backend/internal/middleware"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/requestid"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// slowRequests gives each API call in these tests time to finish. Accounts made through the API
// hash passwords at bcrypt's default cost, which takes over a second per hash under -race, beyond
// app.Test's one-second default.
var slowRequests = fiber.TestConfig{Timeout: 30 * time.Second, FailOnTimeout: true}

func TestAuthRBACIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to a PostgreSQL instance with CREATE DATABASE permission")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	name := fmt.Sprintf("clims_auth_test_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, `CREATE DATABASE `+name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(ctx, `DROP DATABASE `+name+` WITH (FORCE)`); err != nil {
			t.Error(err)
		}
	})
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	pool, err := pgxpool.New(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err = database.RunMigrations(u.String()); err != nil {
		t.Fatal(err)
	}
	if err = database.RunMigrations(u.String()); err != nil {
		t.Fatal(err)
	}

	// Fresh migrated installations must still accept the complete legacy backup.
	seed, err := os.ReadFile(filepath.Join("..", "..", "..", "infra", "database", "clims_postgres_seed.sql"))
	if err != nil {
		t.Fatal(err)
	}
	uuidSeed, err := exec.Command("python3", filepath.Join("..", "..", "..", "scripts", "prepare_legacy_seed.py")).Output()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(uuidSeed)); err != nil {
		t.Fatal(err)
	}
	var nonUUIDKeys int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_constraint c
		JOIN pg_class t ON t.oid=c.conrelid
		JOIN pg_namespace n ON n.oid=t.relnamespace
		JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=ANY(c.conkey)
		WHERE n.nspname='public' AND t.relname <> 'schema_migrations'
		AND c.contype='p' AND a.atttypid <> 'uuid'::regtype`).Scan(&nonUUIDKeys); err != nil {
		t.Fatal(err)
	}
	if nonUUIDKeys != 0 {
		t.Fatalf("found %d non-UUID application primary-key columns", nonUUIDKeys)
	}
	var roleCount, userCount int
	if err = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM roles),(SELECT count(*) FROM users)`).Scan(&roleCount, &userCount); err != nil {
		t.Fatal(err)
	}
	if roleCount != 12 || userCount != 455 {
		t.Fatalf("legacy import: roles=%d users=%d", roleCount, userCount)
	}
	// Importing after migrations resolves the backup's shared usernames and phone numbers.
	assertUniqueIdentifiers(t, pool)
	assertWarehouseGrants(t, pool)
	assertReportAccess(t, pool)
	auditor := audit.NewService(pool)
	repo := users.NewRepository(pool, auditor)
	var legacyAdminID string
	if err = pool.QueryRow(ctx, `SELECT ru.user_id FROM role_user ru JOIN roles r ON r.id=ru.role_id WHERE r.name='admin' LIMIT 1`).Scan(&legacyAdminID); err != nil {
		t.Fatal(err)
	}
	legacyAdmin, err := repo.GetUserByID(ctx, legacyAdminID)
	if err != nil {
		t.Fatal(err)
	}
	if legacyAdmin.Role == nil || legacyAdmin.Role.Name != "admin" || !legacyAdmin.HasPermission("orders:all_stores") {
		t.Fatal("legacy admin role not resolved")
	}
	// Keep the access tests independent of real legacy account credentials.
	if _, err = pool.Exec(ctx, `DELETE FROM users USING role_user ru, roles r WHERE users.id=ru.user_id AND r.id=ru.role_id AND r.name='admin'`); err != nil {
		t.Fatal(err)
	}
	roleIDs := map[string]string{}
	for _, name := range []string{"admin", "moh", "hotspot manager"} {
		var roleID string
		if err := pool.QueryRow(ctx, `SELECT id FROM roles WHERE name=$1`, name).Scan(&roleID); err != nil {
			t.Fatal(err)
		}
		roleIDs[name] = roleID
	}
	adminRole, mohRole, hotspotRole := roleIDs["admin"], roleIDs["moh"], roleIDs["hotspot manager"]
	unknownID := uuid.NewString()
	hash, err := bcrypt.GenerateFromPassword([]byte("test-password-123"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	adminID, err := repo.CreateUser(ctx, users.AccountInput{Username: "test-admin", Email: "admin@example.test"}, string(hash), adminRole)
	if err != nil {
		t.Fatal(err)
	}
	app := fiber.New()
	// The same request context as the server: a request ID, then the audit middleware.
	app.Use(requestid.New())
	app.Use(audit.Middleware(auditor))
	v1 := app.Group("/api/v1")
	service := users.NewService(repo)
	roleRepo := rbac.NewRepository(pool, auditor)
	jwtMiddleware := middleware.NewJWTMiddleware("test-secret")
	activeUser := users.ActiveUser(repo)
	auth.RegisterRoutes(v1, auth.NewHandler(repo, service, "test-secret", auditor), jwtMiddleware, activeUser)
	users.RegisterRoutes(v1, users.NewHandler(repo, service), jwtMiddleware, activeUser)
	rbac.RegisterRoutes(v1, rbac.NewHandler(roleRepo), jwtMiddleware, activeUser)
	notifier := notifications.NewService()
	notifier.MustRegister(hotspots.NotificationTypes()...)
	notifier.MustRegister(orders.NotificationTypes()...)
	notifier.MustRegister(inventory.NotificationTypes()...)
	orders.RegisterRoutes(v1, orders.NewRepository(pool, notifier, auditor), jwtMiddleware, activeUser)
	hotspots.RegisterRoutes(v1, hotspots.NewRepository(pool, notifier, auditor), jwtMiddleware, activeUser)
	inventory.RegisterRoutes(v1, inventory.NewRepository(pool, auditor), jwtMiddleware, activeUser)
	reports.RegisterRoutes(v1, reports.NewRepository(pool), jwtMiddleware, activeUser)
	locations.RegisterRoutes(v1, locations.NewHandler(pool), jwtMiddleware, activeUser)
	notifications.RegisterRoutes(v1, notifications.NewRepository(pool), jwtMiddleware, activeUser)
	catalogue.RegisterRoutes(v1, catalogue.NewRepository(pool, auditor), jwtMiddleware, activeUser)
	audit.RegisterRoutes(v1, audit.NewRepository(pool), auditor, jwtMiddleware, activeUser, rbac.RequirePermission("audit:read"))

	request := func(method, path string, body any, token string, want int) map[string]any {
		t.Helper()
		var data []byte
		if body != nil {
			var err error
			data, err = json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
		}
		req := httptest.NewRequest(method, "/api/v1"+path, bytes.NewReader(data))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		res, err := app.Test(req, slowRequests)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		payload, err := io.ReadAll(res.Body)
		if err != nil {
			t.Fatal(err)
		}
		if res.StatusCode != want {
			t.Fatalf("%s %s: got %d want %d: %s", method, path, res.StatusCode, want, payload)
		}
		if bytes.Contains(payload, []byte("password")) && want < 400 {
			t.Fatal("response exposed a password field")
		}
		var result map[string]any
		if err = json.Unmarshal(payload, &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	login := func(email, password string, want int) string {
		result := request("POST", "/auth/login", map[string]any{"email": email, "password": password}, "", want)
		if want != 200 {
			return ""
		}
		return result["data"].(map[string]any)["token"].(string)
	}
	adminToken := login(" ADMIN@example.test ", "test-password-123", 200)
	request("GET", "/users", nil, "", 401)
	request("GET", "/roles", nil, adminToken, 200)
	request("GET", "/permissions", nil, adminToken, 200)

	var facilityID, hotSpotID, subcountyID, assignedStoreID string
	if err = pool.QueryRow(ctx, `SELECT (SELECT id FROM organization_units LIMIT 1),
		h.id, h.subcounty_id, (SELECT id FROM stores WHERE code = 'jms')
		FROM hot_spots h WHERE h.name IS NOT NULL AND h.subcounty_id IS NOT NULL LIMIT 1`).
		Scan(&facilityID, &hotSpotID, &subcountyID, &assignedStoreID); err != nil {
		t.Fatal(err)
	}
	account := map[string]any{
		"username": "assigned-user", "email": "assigned@example.test", "password": "test-password-123",
		"role_id": hotspotRole, "organisation_unit_id": unknownID, "hot_spot_id": hotSpotID,
	}
	request("POST", "/users", account, adminToken, 422)
	account["organisation_unit_id"] = facilityID
	assignedID := request("POST", "/users", account, adminToken, 201)["data"].(map[string]any)["user_id"]
	if _, err = pool.Exec(ctx, `UPDATE users SET subcounty_id=$2, store_id=$3 WHERE id=$1`, assignedID, subcountyID, assignedStoreID); err != nil {
		t.Fatal(err)
	}
	assignedLogin := request("POST", "/auth/login", map[string]any{
		"login": "assigned@example.test", "password": "test-password-123",
	}, "", 200)["data"].(map[string]any)
	assignedToken := assignedLogin["token"].(string)
	assignedProfile := request("GET", "/auth/me", nil, assignedToken, 200)["data"].(map[string]any)
	for _, profile := range []map[string]any{assignedLogin["user"].(map[string]any), assignedProfile} {
		for key, id := range map[string]string{
			"organisation_unit": facilityID, "hot_spot": hotSpotID, "subcounty": subcountyID, "store": assignedStoreID,
		} {
			details, ok := profile[key].(map[string]any)
			if !ok || details["id"] != id || details["name"] == nil || details["name"] == "" || profile[key+"_id"] != id {
				t.Fatalf("incorrect %s assignment: %v", key, details)
			}
		}
	}

	registration := map[string]any{"username": "newuser", "email": " NewUser@example.test ", "password": "test-password-123", "first_name": "New", "lastname": "User", "location": "Kampala"}
	for _, field := range []string{"role_id", "role_ids", "role", "status", "organisation_unit_id", "hot_spot_id", "remember_token"} {
		bad := map[string]any{"username": "bad", "email": "bad@example.test", "password": "test-password-123", field: 1}
		request("POST", "/auth/register", bad, "", 400)
	}
	id := request("POST", "/auth/register", registration, "", 201)["data"].(map[string]any)["user_id"].(string)
	if _, err := uuid.Parse(id); err != nil {
		t.Fatal("registration did not return a UUID")
	}
	request("POST", "/auth/register", registration, "", 409)
	request("POST", "/auth/register", map[string]any{"username": "longpass", "email": "long@example.test", "password": strings.Repeat("é", 40)}, "", 422)
	login("newuser@example.test", "incorrect", 401)
	// Laravel/MySQL bcrypt hashes use the $2y$ prefix.
	if _, err = pool.Exec(ctx, `UPDATE users SET password=replace(password,'$2a$','$2y$') WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	userToken := login("newuser@example.test", "test-password-123", 200)
	me := request("GET", "/auth/me", nil, userToken, 200)["data"].(map[string]any)
	loginData := request("POST", "/auth/login", map[string]any{"email": "newuser@example.test", "password": "test-password-123"}, "", 200)["data"].(map[string]any)
	for _, profile := range []map[string]any{me, loginData["user"].(map[string]any)} {
		for _, key := range []string{"organisation_unit", "hot_spot", "subcounty", "store"} {
			if details, present := profile[key]; !present || details != nil {
				t.Fatalf("expected null %s assignment, got %v", key, details)
			}
		}
		if profile["first_name"] != "New" || profile["last_name"] != "User" || profile["location"] != "Kampala" ||
			profile["created_at"] == nil || profile["updated_at"] == nil {
			t.Fatalf("profile fields did not round-trip: %v", profile)
		}
		if _, present := profile["remember_token"]; present {
			t.Fatal("profile exposed a remember token")
		}
		roles := profile["roles"].([]any)
		if len(roles) != 1 {
			t.Fatalf("expected one registration role, got %v", roles)
		}
		role := roles[0].(map[string]any)
		if role["id"] != rbac.RegisteredUserRoleID || role["name"] != "registered user" || len(role["permissions"].([]any)) != 0 {
			t.Fatalf("unexpected registration role: %v", role)
		}
	}
	request("GET", "/users", nil, userToken, 403)
	request("PATCH", fmt.Sprintf("/users/%s/role", id), map[string]any{"role_id": adminRole}, userToken, 403)
	request("PATCH", fmt.Sprintf("/users/%s/role", id), map[string]any{"role_id": unknownID}, adminToken, 404)
	request("PATCH", fmt.Sprintf("/users/%s/role", id), map[string]any{"role_id": hotspotRole}, adminToken, 200)
	me = request("GET", "/auth/me", nil, userToken, 200)["data"].(map[string]any)
	if me["role"].(map[string]any)["name"] != "hotspot manager" {
		t.Fatal("legacy role name changed")
	}
	request("PUT", "/roles/"+hotspotRole+"/permissions", map[string]any{"permissions": []string{"users:read"}}, adminToken, 200)
	request("GET", "/users?limit=1", nil, userToken, 200)
	request("POST", "/users", map[string]any{}, userToken, 403)
	request("PUT", "/roles/"+hotspotRole+"/permissions", map[string]any{"permissions": []string{"unknown:permission"}}, adminToken, 422)
	request("GET", "/users", nil, userToken, 200) // Invalid update rolled back.
	request("PUT", "/roles/"+hotspotRole+"/permissions", map[string]any{"permissions": []string{}}, adminToken, 200)
	request("GET", "/users", nil, userToken, 403) // Existing JWT loses access immediately.
	request("PUT", "/roles/"+hotspotRole+"/permissions", map[string]any{"permissions": []string{"users:create"}}, adminToken, 200)
	request("POST", "/users", map[string]any{"username": "escalation", "email": "escalation@example.test", "password": "test-password-123", "role_id": adminRole}, userToken, 403)
	request("PUT", "/roles/"+hotspotRole+"/permissions", map[string]any{"permissions": []string{}}, adminToken, 200)
	rolePath := fmt.Sprintf("/users/%s/roles", id)
	request("PUT", rolePath, map[string]any{"role_ids": []string{mohRole, hotspotRole}}, userToken, 403)
	request("PUT", rolePath, map[string]any{"role_ids": []string{mohRole, hotspotRole, hotspotRole}}, adminToken, 200)
	request("PUT", "/roles/"+mohRole+"/permissions", map[string]any{"permissions": []string{"roles:read"}}, adminToken, 200)
	request("PUT", "/roles/"+hotspotRole+"/permissions", map[string]any{"permissions": []string{"users:read"}}, adminToken, 200)
	request("GET", "/roles", nil, userToken, 200)
	request("GET", "/users?limit=1", nil, userToken, 200)
	me = request("GET", "/auth/me", nil, userToken, 200)["data"].(map[string]any)
	if len(me["roles"].([]any)) != 2 {
		t.Fatal("role assignments were lost or duplicated")
	}
	request("PUT", rolePath, map[string]any{"role_ids": []string{mohRole, unknownID}}, adminToken, 422)
	request("GET", "/users?limit=1", nil, userToken, 200)
	request("PUT", rolePath, map[string]any{"role_ids": nil}, adminToken, 422)
	request("PUT", rolePath, map[string]any{"role_ids": []string{}}, adminToken, 200)
	request("GET", "/roles", nil, userToken, 403)
	request("GET", "/users", nil, userToken, 403)
	request("PUT", fmt.Sprintf("/users/%s/roles", adminID), map[string]any{"role_ids": []string{mohRole, hotspotRole}}, adminToken, 409)
	request("PUT", "/roles/"+adminRole+"/permissions", map[string]any{"permissions": []string{}}, adminToken, 409)
	// Anyone can sign up into the registered user role, so it holds nothing.
	request("PUT", "/roles/"+rbac.RegisteredUserRoleID+"/permissions", map[string]any{"permissions": []string{"orders:read"}}, adminToken, 409)
	request("PUT", "/roles/"+rbac.RegisteredUserRoleID+"/permissions", map[string]any{"permissions": []string{}}, adminToken, 200)
	request("PATCH", fmt.Sprintf("/users/%s/status", id), map[string]any{"status": "disabled"}, adminToken, 200)
	request("GET", "/auth/me", nil, userToken, 403)
	login("newuser@example.test", "test-password-123", 403)
	request("PATCH", fmt.Sprintf("/users/%s/status", id), map[string]any{"status": "active"}, adminToken, 200)
	// Disabling revoked the user's sessions, so re-enabling does not revive the old token.
	request("GET", "/auth/me", nil, userToken, 401)
	userToken = login("newuser@example.test", "test-password-123", 200)
	request("GET", "/auth/me", nil, userToken, 200)
	testSessions(t, pool, request, login, adminToken, id, "newuser@example.test")
	testLoginIdentifiers(t, request, adminToken, mohRole)
	userToken = login("newuser@example.test", "test-password-123", 200)

	// A role given users:update, users:create and roles:assign manages accounts, but only administrators
	// can hand out the administrator role or change an administrator's account.
	var mohPermissions, userRoles []string
	if err := pool.QueryRow(context.Background(), `SELECT coalesce(array_agg(p.name), '{}') FROM role_permission rp
		JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1`, mohRole).Scan(&mohPermissions); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(context.Background(), `SELECT coalesce(array_agg(role_id::text), '{}') FROM role_user
		WHERE user_id = $1`, id).Scan(&userRoles); err != nil {
		t.Fatal(err)
	}
	request("PUT", "/roles/"+mohRole+"/permissions", map[string]any{"permissions": []string{"users:read", "users:create", "users:update", "roles:assign"}}, adminToken, 200)
	request("PUT", rolePath, map[string]any{"role_ids": []string{mohRole}}, adminToken, 200)
	request("PUT", rolePath, map[string]any{"role_ids": []string{mohRole, adminRole}}, userToken, 403)
	request("PATCH", fmt.Sprintf("/users/%s/role", id), map[string]any{"role_id": adminRole}, userToken, 403)
	request("POST", "/users", map[string]any{"username": "made-admin", "email": "made-admin@example.test",
		"password": "test-password-123", "role_ids": []string{adminRole}}, userToken, 403)
	request("PATCH", fmt.Sprintf("/users/%s/status", adminID), map[string]any{"status": "disabled"}, userToken, 403)
	request("PATCH", fmt.Sprintf("/users/%s/store", adminID), map[string]any{"store_id": nil}, userToken, 403)
	request("DELETE", fmt.Sprintf("/users/%s/sessions", adminID), nil, userToken, 403)
	request("PUT", rolePath, map[string]any{"role_ids": []string{mohRole, hotspotRole}}, userToken, 200)
	request("PUT", rolePath, map[string]any{"role_ids": userRoles}, adminToken, 200)
	request("PUT", "/roles/"+mohRole+"/permissions", map[string]any{"permissions": mohPermissions}, adminToken, 200)
	request("GET", "/users?limit=101", nil, adminToken, 400)
	request("GET", "/users?offset=-1", nil, adminToken, 400)
	request("GET", "/users/not-a-number", nil, adminToken, 400)
	request("GET", "/users/"+unknownID, nil, adminToken, 404)
	request("GET", "/users/123", nil, adminToken, 400)
	request("PUT", rolePath, map[string]any{"role_ids": []int{7}}, adminToken, 400)
	request("PATCH", fmt.Sprintf("/users/%s/status", adminID), map[string]any{"status": "disabled"}, adminToken, 409)
	request("PATCH", fmt.Sprintf("/users/%s/role", adminID), map[string]any{"role_id": mohRole}, adminToken, 409)
	created := map[string]any{"username": "second-admin", "email": "second-admin@example.test", "password": "test-password-123", "role_ids": []string{adminRole, hotspotRole}}
	secondID := request("POST", "/users", created, adminToken, 201)["data"].(map[string]any)["user_id"].(string)

	// Orders exercise the migrated schema and both sides of store authorization.
	var sourceID, destinationID, condomID, unitID string
	if err = pool.QueryRow(ctx, `
		WITH source AS (SELECT id FROM stores WHERE code = 'jms'),
		     region AS (INSERT INTO regions(uid, name) VALUES ('test-region', 'Test region') RETURNING id),
		     district AS (INSERT INTO districts(uid, name, region_id)
		         SELECT 'test-district', 'Test district', id FROM region RETURNING id),
		     destination AS (INSERT INTO stores(code, name, store_type, district_id)
		         SELECT 'test-district', 'Test district store', 'district', id FROM district RETURNING id),
		     product AS (SELECT id FROM condoms WHERE active ORDER BY id LIMIT 1),
		     unit AS (SELECT id FROM unit_of_measures ORDER BY id LIMIT 1)
		SELECT source.id, destination.id, product.id, unit.id FROM source, destination, product, unit
	`).Scan(&sourceID, &destinationID, &condomID, &unitID); err != nil {
		t.Fatal(err)
	}
	// Orders are visible to the stores they involve. Generic store-to-store orders can no longer be
	// placed (migration 32), but those already recorded stay readable.
	var orderID string
	if err = pool.QueryRow(ctx, `INSERT INTO orders (condom_id, quantity_needed, order_date, ordered_by_id,
			ordered_for_store_id, ordered_from_store_id, unit_of_measure_id)
		VALUES ($1, 100, '2026-11-19', $2, $3, $4, $5) RETURNING id`,
		condomID, adminID, destinationID, sourceID, unitID).Scan(&orderID); err != nil {
		t.Fatal(err)
	}
	request("GET", "/orders", nil, "", 401)
	request("GET", "/orders", nil, userToken, 403)
	request("PUT", rolePath, map[string]any{"role_ids": []string{hotspotRole}}, adminToken, 200)
	request("PUT", "/roles/"+hotspotRole+"/permissions",
		map[string]any{"permissions": []string{"orders:read"}}, adminToken, 200)
	if _, err = pool.Exec(ctx, `UPDATE users SET store_id=$1 WHERE id=$2`, sourceID, id); err != nil {
		t.Fatal(err)
	}
	orderPath := "/orders/" + orderID
	if order := request("GET", orderPath, nil, userToken, 200)["data"].(map[string]any); order["order_status"] != "pending" ||
		order["order_date"] != "2026-11-19" || order["ordered_by_id"] != adminID {
		t.Fatalf("unexpected generic order: %v", order)
	}
	// POST /orders and PATCH /orders/{id}/fulfill are gone (TestOpenAPIRouteCoverage checks no route is
	// left undocumented); the orders-only inbox's path now reads as an order ID.
	request("GET", "/orders/notifications", nil, adminToken, 400)
	request("POST", orderPath+"/actions/review", nil, adminToken, 409) // generic orders have no workflow
	var removed int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM permissions
		WHERE name IN ('orders:create', 'orders:fulfill')`).Scan(&removed); err != nil || removed != 0 {
		t.Fatalf("unused order permissions remain: %d %v", removed, err)
	}
	// orders:deliver, removed with the old rider dispatch, returns for delivery agents (migration 35).
	var agents bool
	if err = pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM role_permission rp JOIN roles r ON r.id = rp.role_id
		JOIN permissions p ON p.id = rp.permission_id WHERE r.name = 'delivery agent' AND p.name = 'orders:deliver')`).
		Scan(&agents); err != nil || !agents {
		t.Fatalf("delivery agents should hold orders:deliver: %v %v", agents, err)
	}
	if _, err = pool.Exec(ctx, `UPDATE users SET store_id=NULL WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	request("GET", orderPath, nil, userToken, 404)
	if visible := request("GET", "/orders", nil, userToken, 200)["data"]; len(visible.([]any)) != 0 {
		t.Fatalf("orders leaked to unassigned user: %v", visible)
	}

	testDistrictStockouts(t, pool, request, login, adminToken, condomID)
	testDistrictAccounts(t, pool, request, login, adminToken)
	testManagerVisibility(t, pool, request, login, adminToken)
	testHotSpotActivation(t, pool, request, login, adminToken, destinationID)
	testNotifications(t, pool, request, login, adminToken, destinationID)
	testAudit(t, pool, repo, service, auditor, adminToken)
	testOrderWorkflow(t, pool, request, login, adminToken, sourceID, destinationID, condomID, unitID)
	testCatalogue(t, pool, request, adminToken, userToken, sourceID, destinationID)
	testStoreAssignment(t, pool, request, adminToken, userToken)
	testFeatureAudit(t, pool)

	// Two simultaneous updates must leave at least one administrator active.
	results := make(chan error, 2)
	for _, userID := range []string{adminID, secondID} {
		go func(id string) { status := "disabled"; results <- repo.UpdateUserAccess(ctx, id, nil, &status) }(userID)
	}
	successes, conflicts := 0, 0
	for range 2 {
		err := <-results
		if err == nil {
			successes++
		} else if errors.Is(err, users.ErrLastAdmin) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent admin changes: success=%d conflict=%d", successes, conflicts)
	}

	// Existing databases upgrade without altering legacy roles or granting extra access.
	upgradeName := name + "_upgrade"
	if _, err = admin.Exec(ctx, `CREATE DATABASE `+upgradeName); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(ctx, `DROP DATABASE `+upgradeName+` WITH (FORCE)`); err != nil {
			t.Error(err)
		}
	})
	u.Path = "/" + upgradeName
	upgrade, err := pgxpool.New(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(upgrade.Close)
	schema, err := os.ReadFile(filepath.Join("..", "database", "migrations", "000001_init_schema.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = upgrade.Exec(ctx, string(schema)); err != nil {
		t.Fatal(err)
	}
	if _, err = upgrade.Exec(ctx, string(seed)); err != nil {
		t.Fatal(err)
	}
	if _, err = upgrade.Exec(ctx, `INSERT INTO orders
		(ordered_by, ordered_for, ordered_from, order_status, quantity_needed, order_date, comment)
		VALUES ('1', 'district', 'jms', 'pending', '20', '2026-11-19', 'legacy order fixture')`); err != nil {
		t.Fatal(err)
	}
	if _, err = upgrade.Exec(ctx, `CREATE TABLE schema_migrations(version bigint NOT NULL PRIMARY KEY,dirty boolean NOT NULL); INSERT INTO schema_migrations VALUES(1,false)`); err != nil {
		t.Fatal(err)
	}
	// Simulate a database that has already issued RBAC UUIDs and has custom grants.
	for _, migration := range []string{"000002_auth_rbac.up.sql", "000003_schema_rbac.up.sql"} {
		sql, err := os.ReadFile(filepath.Join("..", "database", "migrations", migration))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := upgrade.Exec(ctx, string(sql)); err != nil {
			t.Fatal(err)
		}
	}
	var existingUserUUID, existingRoleUUID string
	if err = upgrade.QueryRow(ctx, `SELECT u.rbac_id, r.rbac_id FROM users u
		JOIN role_user ru ON ru.user_id = u.rbac_id JOIN roles r ON r.rbac_id = ru.role_id
		WHERE r.name = 'admin' ORDER BY u.id LIMIT 1`).Scan(&existingUserUUID, &existingRoleUUID); err != nil {
		t.Fatal(err)
	}
	if _, err = upgrade.Exec(ctx, `UPDATE schema_migrations SET version=3;
		INSERT INTO role_permission(role_id, permission_id)
		SELECT r.rbac_id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name='moh' AND p.name='users:create'`); err != nil {
		t.Fatal(err)
	}
	if err = database.RunMigrations(u.String()); err != nil {
		t.Fatal(err)
	}
	// Migrations 18 and 23 grant catalogue:manage to moh, nms and jms, and migration 39 takes it back from
	// moh, which becomes read-only. Migrations 31 and 38 give the warehouse and DCFP roles their order,
	// inventory and (DCFP) report defaults, migration 35 gives delivery agents orders:deliver,
	// migration 39 gives moh every read permission and the warehouses reports:read, and migration 40 gives
	// the DCFP role its district user permissions. Every other non-admin grant is the custom one, which
	// survives even though migration 39 makes moh read-only by default.
	var catalogueManagers string
	if err = upgrade.QueryRow(ctx, `SELECT (SELECT count(*) FROM users),
		(SELECT count(*) FROM role_permission rp JOIN roles r ON r.id = rp.role_id
			JOIN permissions p ON p.id = rp.permission_id WHERE r.name<>'admin' AND p.name<>'catalogue:manage'
			AND NOT (r.name IN ('nms', 'jms', 'dfcp') AND (p.name LIKE 'orders:%' OR p.name LIKE 'inventory:%'))
			AND NOT (r.name IN ('dfcp', 'nms', 'jms') AND p.name = 'reports:read')
			AND NOT (r.name = 'moh' AND p.name IN ('audit:read', 'hotspots:all_districts', 'hotspots:read',
				'hotspots:read_district', 'inventory:read', 'orders:all_stores', 'orders:read', 'reports:read',
				'roles:read', 'users:read'))
			AND NOT (r.name = 'delivery agent' AND p.name = 'orders:deliver')
			AND NOT (r.name = 'dfcp' AND p.name IN ('users:district_read', 'users:district_create'))),
		(SELECT string_agg(r.name, ',' ORDER BY r.name) FROM role_permission rp JOIN roles r ON r.id = rp.role_id
			JOIN permissions p ON p.id = rp.permission_id WHERE r.name<>'admin' AND p.name='catalogue:manage')`).Scan(
		&userCount, &roleCount, &catalogueManagers); err != nil {
		t.Fatal(err)
	}
	if userCount != 455 || roleCount != 1 || catalogueManagers != "jms,nms" {
		t.Fatalf("upgrade changed user count, lost custom permission grants or granted the catalogue to %q", catalogueManagers)
	}
	assertWarehouseGrants(t, upgrade)
	// Upgrading a database that already holds the backup resolves the same duplicates.
	assertUniqueIdentifiers(t, upgrade)
	var sameAssignment bool
	if err = upgrade.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM role_user WHERE user_id=$1 AND role_id=$2
	)`, existingUserUUID, existingRoleUUID).Scan(&sameAssignment); err != nil {
		t.Fatal(err)
	}
	if !sameAssignment {
		t.Fatal("upgrade changed an existing RBAC UUID or assignment")
	}

	var archived, current int
	if err = upgrade.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM legacy_orders WHERE comment = 'legacy order fixture'),
		(SELECT count(*) FROM orders)`).Scan(&archived, &current); err != nil {
		t.Fatal(err)
	}
	if archived != 1 || current != 0 {
		t.Fatalf("legacy orders upgrade: archived=%d current=%d", archived, current)
	}

	// Upgraded legacy products keep their UUIDs and convert like freshly imported ones.
	var products, archivedProducts, activeProducts, brandCount int
	if err = upgrade.QueryRow(ctx, `SELECT (SELECT count(*) FROM condoms), (SELECT count(*) FROM legacy_condoms l
		JOIN condoms c ON c.id = l.id), (SELECT count(*) FROM condoms WHERE active), (SELECT count(*) FROM brands)`).Scan(
		&products, &archivedProducts, &activeProducts, &brandCount); err != nil {
		t.Fatal(err)
	}
	if products != 4 || archivedProducts != 4 || activeProducts != 2 || brandCount != 2 {
		t.Fatalf("legacy catalogue upgrade: products=%d archived=%d active=%d brands=%d",
			products, archivedProducts, activeProducts, brandCount)
	}

	// Upgrades gain the second national warehouse and fill in missing warehouse stores.
	var nationalStores, jmsWithoutStore int
	if err = upgrade.QueryRow(ctx, `SELECT (SELECT count(*) FROM stores WHERE store_type = 'national'),
		(SELECT count(*) FROM users u JOIN role_user ru ON ru.user_id = u.id JOIN roles r ON r.id = ru.role_id
			WHERE r.name = 'jms' AND u.store_id IS NULL)`).Scan(&nationalStores, &jmsWithoutStore); err != nil {
		t.Fatal(err)
	}
	if nationalStores != 2 || jmsWithoutStore != 0 {
		t.Fatalf("store assignment upgrade: national=%d jms without store=%d", nationalStores, jmsWithoutStore)
	}

}

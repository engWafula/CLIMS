package integration

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// cheapPassword is "test-password-123" hashed at bcrypt's lowest cost. Accounts these tests only need
// to sign in as are stored with it: the default cost takes over a second per hash under -race, and
// CI gives the whole suite five minutes.
func cheapPassword(t *testing.T) string {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("test-password-123"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	return string(hash)
}

// seedAccount stores an active account holding the named roles, with cheapPassword, and returns its ID.
// Its email is name@example.test.
func seedAccount(t *testing.T, pool *pgxpool.Pool, name string, roles ...string) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := pool.QueryRow(ctx, `INSERT INTO users (username, email, password, firstname, lastname, phone_number, status, created_at, updated_at)
		VALUES ($1, $2, $3, '', '', '', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id`,
		name, name+"@example.test", cheapPassword(t)).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO role_user (user_id, role_id) SELECT $1, id FROM roles WHERE name = ANY($2)`,
		id, roles); err != nil {
		t.Fatal(err)
	}
	return id
}

// testDistrictAccounts checks that a district focal person creates VHT, hotspot manager and
// delivery agent accounts in their own district only (migration 40, POST /users/district).
func testDistrictAccounts(t *testing.T, pool *pgxpool.Pool,
	request func(string, string, any, string, int) map[string]any,
	login func(string, string, int) string,
	admin string,
) {
	t.Helper()
	ctx := context.Background()
	scalar := func(dest any, sql string, args ...any) {
		t.Helper()
		if err := pool.QueryRow(ctx, sql, args...).Scan(dest); err != nil {
			t.Fatal(err)
		}
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	fieldError := func(what string, result map[string]any, field string) {
		t.Helper()
		if fields, _ := result["error"].(map[string]any); fields[field] == nil {
			t.Errorf("%s: want an error on %s, got %v", what, field, result["error"])
		}
	}

	// The district focal person role holds both permissions from migration 40; general user
	// management stays with administrators.
	var granted int
	scalar(&granted, `SELECT count(*) FROM role_permission rp JOIN roles r ON r.id = rp.role_id
		JOIN permissions p ON p.id = rp.permission_id
		WHERE r.name = 'dfcp' AND p.name IN ('users:district_read', 'users:district_create')`)
	if granted != 2 {
		t.Fatalf("dfcp should hold both district user permissions, holds %d", granted)
	}
	var general int
	scalar(&general, `SELECT count(*) FROM role_permission rp JOIN roles r ON r.id = rp.role_id
		JOIN permissions p ON p.id = rp.permission_id
		WHERE r.name = 'dfcp' AND p.name IN ('users:create', 'roles:assign')`)
	if general != 0 {
		t.Fatalf("dfcp must not hold users:create or roles:assign")
	}

	// A district with its store and a subcounty, and a subcounty in another district.
	var district, store, subcounty, otherSubcounty, otherDistrict string
	scalar(&district, `SELECT d.id FROM districts d JOIN stores st ON st.district_id = d.id AND st.store_type = 'district'
		JOIN subcounties s ON s.district_id = d.id ORDER BY d.uid DESC LIMIT 1`)
	scalar(&store, `SELECT id FROM stores WHERE district_id = $1 AND store_type = 'district' ORDER BY code LIMIT 1`, district)
	scalar(&subcounty, `SELECT id FROM subcounties WHERE district_id = $1 ORDER BY uid LIMIT 1`, district)
	scalar(&otherSubcounty, `SELECT id FROM subcounties WHERE district_id <> $1 ORDER BY uid LIMIT 1`, district)
	scalar(&otherDistrict, `SELECT district_id FROM subcounties WHERE id = $1`, otherSubcounty)

	// Two hotspots, put back as found: active in the district, and active elsewhere.
	var active, elsewhere string
	scalar(&active, `SELECT id FROM hot_spots ORDER BY id LIMIT 1 OFFSET 60`)
	scalar(&elsewhere, `SELECT id FROM hot_spots ORDER BY id LIMIT 1 OFFSET 61`)
	type saved struct {
		status, review      string
		district, subcounty *string
	}
	originals := map[string]saved{}
	for _, id := range []string{active, elsewhere} {
		var row saved
		scalar(&row.status, `SELECT status FROM hot_spots WHERE id = $1`, id)
		scalar(&row.review, `SELECT review_status FROM hot_spots WHERE id = $1`, id)
		scalar(&row.district, `SELECT district_id FROM hot_spots WHERE id = $1`, id)
		scalar(&row.subcounty, `SELECT subcounty_id FROM hot_spots WHERE id = $1`, id)
		originals[id] = row
	}
	defer func() {
		for id, row := range originals {
			exec(`UPDATE hot_spots SET status = $2, review_status = $3, district_id = $4, subcounty_id = $5 WHERE id = $1`,
				id, row.status, row.review, row.district, row.subcounty)
		}
	}()
	exec(`UPDATE hot_spots SET status = 'active', review_status = 'active', district_id = $2, subcounty_id = $3 WHERE id = $1`,
		active, district, subcounty)
	exec(`UPDATE hot_spots SET status = 'active', review_status = 'active', district_id = $2, subcounty_id = $3 WHERE id = $1`,
		elsewhere, otherDistrict, otherSubcounty)

	dcfp := func(name string, storeID *string) string {
		t.Helper()
		id := seedAccount(t, pool, name, "dfcp")
		exec(`UPDATE users SET store_id = $2 WHERE id = $1`, id, storeID)
		return login(name+"@example.test", "test-password-123", 200)
	}
	focal := dcfp("district-focal", &store)
	unassigned := dcfp("unassigned-focal", nil)

	n := 0
	body := func(role string, extra map[string]any) map[string]any {
		n++
		name := "field-" + string(rune('a'+n))
		b := map[string]any{"username": name, "email": name + "@example.test", "password": "test-password-123",
			"first_name": "Field", "last_name": "Worker", "role": role}
		for k, v := range extra {
			b[k] = v
		}
		return b
	}
	created := func(result map[string]any) string {
		t.Helper()
		return result["data"].(map[string]any)["user_id"].(string)
	}

	// No district, no accounts; and only the three field roles.
	request("POST", "/users/district", body("vht", map[string]any{"subcounty_id": subcounty}), unassigned, 403)
	request("GET", "/users/district", nil, unassigned, 403)
	fieldError("admin role", request("POST", "/users/district", body("admin", nil), focal, 422), "role")
	fieldError("dfcp role", request("POST", "/users/district", body("dfcp", nil), focal, 422), "role")

	// A VHT works in a subcounty of the district.
	fieldError("vht without subcounty", request("POST", "/users/district", body("vht", nil), focal, 422), "subcounty_id")
	fieldError("vht elsewhere", request("POST", "/users/district",
		body("vht", map[string]any{"subcounty_id": otherSubcounty}), focal, 422), "subcounty_id")
	vht := created(request("POST", "/users/district", body("vht", map[string]any{
		"subcounty_id": subcounty, "hot_spot_id": active,
	}), focal, 201))
	var gotSubcounty, gotHotSpot, gotStore *string
	scalar(&gotSubcounty, `SELECT subcounty_id FROM users WHERE id = $1`, vht)
	scalar(&gotHotSpot, `SELECT hot_spot_id FROM users WHERE id = $1`, vht)
	scalar(&gotStore, `SELECT store_id FROM users WHERE id = $1`, vht)
	if gotSubcounty == nil || *gotSubcounty != subcounty || gotHotSpot != nil || gotStore != nil {
		t.Errorf("vht assignment: subcounty %v hotspot %v store %v", gotSubcounty, gotHotSpot, gotStore)
	}

	// A hotspot manager runs an active hotspot of the district, and works in its subcounty.
	fieldError("manager without hotspot", request("POST", "/users/district", body("hotspot manager", nil), focal, 422), "hot_spot_id")
	fieldError("manager elsewhere", request("POST", "/users/district",
		body("hotspot manager", map[string]any{"hot_spot_id": elsewhere}), focal, 422), "hot_spot_id")
	manager := created(request("POST", "/users/district",
		body("hotspot manager", map[string]any{"hot_spot_id": active}), focal, 201))
	scalar(&gotHotSpot, `SELECT hot_spot_id FROM users WHERE id = $1`, manager)
	scalar(&gotSubcounty, `SELECT subcounty_id FROM users WHERE id = $1`, manager)
	if gotHotSpot == nil || *gotHotSpot != active || gotSubcounty == nil || *gotSubcounty != subcounty {
		t.Errorf("manager assignment: hotspot %v subcounty %v", gotHotSpot, gotSubcounty)
	}

	// A delivery agent carries from the district store.
	agent := created(request("POST", "/users/district", body("delivery agent", nil), focal, 201))
	scalar(&gotStore, `SELECT store_id FROM users WHERE id = $1`, agent)
	if gotStore == nil || *gotStore != store {
		t.Errorf("delivery agent store: %v, want %s", gotStore, store)
	}

	// The list holds exactly the district's field workers: not the DCFP, nor anyone elsewhere.
	listed := map[string]bool{}
	for _, item := range request("GET", "/users/district", nil, focal, 200)["data"].(map[string]any)["users"].([]any) {
		listed[item.(map[string]any)["id"].(string)] = true
	}
	for _, id := range []string{vht, manager, agent} {
		if !listed[id] {
			t.Errorf("field user %s missing from the district list", id)
		}
	}
	var focalID string
	scalar(&focalID, `SELECT id FROM users WHERE username = 'district-focal'`)
	if listed[focalID] {
		t.Errorf("the district list should hold field workers only")
	}

	// A field worker cannot create accounts.
	var vhtEmail string
	scalar(&vhtEmail, `SELECT email FROM users WHERE id = $1`, vht)
	exec(`UPDATE users SET password = $2 WHERE id = $1`, vht, cheapPassword(t))
	request("POST", "/users/district", body("vht", map[string]any{"subcounty_id": subcounty}),
		login(vhtEmail, "test-password-123", 200), 403)
}

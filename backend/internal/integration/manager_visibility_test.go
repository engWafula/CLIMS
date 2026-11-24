package integration

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// testManagerVisibility checks that a hotspot manager sees and reports only their own hotspot's
// stockouts, even when their account also holds orders:all_stores and a district store: grants an
// administrator may add for other reasons, which once showed managers every hotspot's requests.
func testManagerVisibility(t *testing.T, pool *pgxpool.Pool,
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

	// Two active hotspots in a district with a store, put back as found afterwards.
	var district, store, subcounty string
	scalar(&district, `SELECT d.id FROM districts d JOIN stores st ON st.district_id = d.id AND st.store_type = 'district'
		JOIN subcounties s ON s.district_id = d.id ORDER BY d.uid LIMIT 1 OFFSET 1`)
	scalar(&store, `SELECT id FROM stores WHERE district_id = $1 AND store_type = 'district' ORDER BY code LIMIT 1`, district)
	scalar(&subcounty, `SELECT id FROM subcounties WHERE district_id = $1 ORDER BY uid LIMIT 1`, district)
	var mine, theirs string
	scalar(&mine, `SELECT id FROM hot_spots ORDER BY id LIMIT 1 OFFSET 70`)
	scalar(&theirs, `SELECT id FROM hot_spots ORDER BY id LIMIT 1 OFFSET 71`)
	type saved struct {
		status, review      string
		district, subcounty *string
	}
	originals := map[string]saved{}
	for _, id := range []string{mine, theirs} {
		var row saved
		scalar(&row.status, `SELECT status FROM hot_spots WHERE id = $1`, id)
		scalar(&row.review, `SELECT review_status FROM hot_spots WHERE id = $1`, id)
		scalar(&row.district, `SELECT district_id FROM hot_spots WHERE id = $1`, id)
		scalar(&row.subcounty, `SELECT subcounty_id FROM hot_spots WHERE id = $1`, id)
		originals[id] = row
		exec(`UPDATE hot_spots SET status = 'active', review_status = 'active', district_id = $2, subcounty_id = $3 WHERE id = $1`,
			id, district, subcounty)
	}

	// A manager of `mine` whose account was also given orders:all_stores (through a role of its own)
	// and the district store.
	var wideRole string
	scalar(&wideRole, `INSERT INTO roles (name) VALUES ('wide manager test') RETURNING id`)
	exec(`INSERT INTO role_permission (role_id, permission_id) SELECT $1, id FROM permissions
		WHERE name IN ('orders:read', 'orders:stockout', 'orders:all_stores')`, wideRole)
	managerID := seedAccount(t, pool, "wide-manager", "hotspot manager", "wide manager test")
	exec(`UPDATE users SET hot_spot_id = $2, store_id = $3 WHERE id = $1`, managerID, mine, store)
	defer func() {
		exec(`UPDATE users SET status = 'disabled', hot_spot_id = NULL, store_id = NULL WHERE id = $1`, managerID)
		exec(`DELETE FROM role_user WHERE role_id = $1`, wideRole)
		exec(`DELETE FROM role_permission WHERE role_id = $1`, wideRole)
		exec(`DELETE FROM roles WHERE id = $1`, wideRole)
		for id, row := range originals {
			exec(`UPDATE hot_spots SET status = $2, review_status = $3, district_id = $4, subcounty_id = $5 WHERE id = $1`,
				id, row.status, row.review, row.district, row.subcounty)
		}
	}()
	manager := login("wide-manager@example.test", "test-password-123", 200)

	reportID := func(result map[string]any) string {
		t.Helper()
		return result["data"].(map[string]any)["id"].(string)
	}
	// The other hotspot's stockout goes to the same district store the manager was given.
	other := reportID(request("POST", "/orders/stockouts",
		map[string]any{"hot_spot_id": theirs, "condom_category": "female"}, admin, 201))
	own := reportID(request("POST", "/orders/stockouts",
		map[string]any{"hot_spot_id": mine, "condom_category": "male"}, manager, 201))

	// The manager sees their hotspot's report only, in the list and by ID.
	listed := request("GET", "/orders/stockouts?limit=100", nil, manager, 200)["data"].([]any)
	if len(listed) == 0 {
		t.Fatal("the manager should see their own hotspot's report")
	}
	for _, item := range listed {
		report := item.(map[string]any)
		if report["hot_spot_id"] != mine {
			t.Errorf("the manager sees a report for another hotspot: %v (%v)", report["id"], report["hot_spot_id"])
		}
	}
	request("GET", "/orders/stockouts/"+own, nil, manager, 200)
	request("GET", "/orders/stockouts/"+other, nil, manager, 404)
	// Nor can they report for another hotspot.
	request("POST", "/orders/stockouts", map[string]any{"hot_spot_id": theirs, "condom_category": "male"}, manager, 403)
	// The district store's people still see both.
	request("GET", "/orders/stockouts/"+other, nil, admin, 200)
}

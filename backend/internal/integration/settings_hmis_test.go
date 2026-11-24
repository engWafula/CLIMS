package integration

import (
	"context"
	"testing"
	"time"

	"clims-backend/internal/features/reports"

	"github.com/jackc/pgx/v5/pgxpool"
)

// testSettingsAndHMIS checks saved response settings (RF07, RN11) and HMIS 105 readiness (RF14) after
// the fulfilment checks, in which the hotspot manager acknowledged 290 male and 100 female pieces.
func testSettingsAndHMIS(t *testing.T, pool *pgxpool.Pool,
	request func(string, string, any, string, int) map[string]any,
	admin, districtToken, otherDistrictToken, warehouse, district string,
) {
	t.Helper()
	data := func(method, path string, body any, token string, code int) map[string]any {
		t.Helper()
		return request(method, path, body, token, code)["data"].(map[string]any)
	}
	expect := func(what string, got map[string]any, want map[string]any) {
		t.Helper()
		for key, value := range want {
			if got[key] != value {
				t.Fatalf("%s: %s = %v, want %v (%v)", what, key, got[key], value, got)
			}
		}
	}
	setting := func(store any, cycle string, days, target int) map[string]any {
		return map[string]any{"store_id": store, "review_cycle": cycle, "deadline_days": days, "target_percent": target,
			"reason": "Agreed at the quarterly review"}
	}

	// Without saved settings the draft defaults apply.
	expect("defaults", data("GET", "/reports/settings", nil, admin, 200)["effective"].(map[string]any),
		map[string]any{"source": "default", "review_cycle": "monthly", "deadline_days": float64(7), "target_percent": float64(80)})

	// National settings need orders:all_stores and cannot reach into the past.
	yesterday := time.Now().In(reports.Kampala).AddDate(0, 0, -1).Format(time.DateOnly)
	past := setting(nil, "weekly", 3, 90)
	past["effective_from"] = yesterday
	request("POST", "/reports/settings", past, admin, 422)
	request("POST", "/reports/settings", setting(nil, "daily", 3, 90), admin, 422)
	// A store that does not exist is refused, not a server error.
	request("POST", "/reports/settings", setting("6f0f6e8a-1d2b-4c3d-8e9f-0a1b2c3d4e5f", "weekly", 3, 90), admin, 422)
	request("POST", "/reports/settings", setting(nil, "weekly", 3, 90), districtToken, 403) // no reports:configure yet
	national := data("POST", "/reports/settings", setting(nil, "weekly", 3, 90), admin, 201)
	expect("national", national, map[string]any{"source": "national", "set_by_id": national["set_by_id"]})

	// A DCFP sets their own store's targets only (RN11).
	var dfcpRole string
	if err := pool.QueryRow(context.Background(), `SELECT id FROM roles WHERE name = 'dfcp'`).Scan(&dfcpRole); err != nil {
		t.Fatal(err)
	}
	request("PUT", "/roles/"+dfcpRole+"/permissions", map[string]any{"permissions": []string{"orders:read", "orders:replenish",
		"orders:receive", "orders:supply_hotspots", "reports:read", "reports:configure"}}, admin, 200)
	request("POST", "/reports/settings", setting(warehouse, "monthly", 5, 70), districtToken, 403)
	request("POST", "/reports/settings", setting(nil, "monthly", 5, 70), districtToken, 403)
	data("POST", "/reports/settings", setting(district, "monthly", 5, 70), districtToken, 201)
	request("GET", "/reports/settings?store_id="+warehouse, nil, districtToken, 403)
	own := data("GET", "/reports/settings?store_id="+district, nil, districtToken, 200)
	if len(own["history"].([]any)) != 1 {
		t.Fatalf("district settings history: %v", own["history"])
	}

	// Reports use the settings in effect: the district's own, else national; parameters still override.
	expect("district report", data("GET", "/reports/notifications", nil, districtToken, 200)["settings"].(map[string]any),
		map[string]any{"source": "store", "deadline_days": float64(5), "target_percent": float64(70)})
	nationalReport := data("GET", "/reports/notifications", nil, admin, 200)
	expect("national report", nationalReport["settings"].(map[string]any), map[string]any{"source": "national", "review_cycle": "weekly"})
	expect("national deadline", nationalReport["deadline"].(map[string]any), map[string]any{"days": float64(3), "target_percent": float64(90)})
	if from := nationalReport["period"].(map[string]any)["from"]; from != reports.CycleStart("weekly", time.Now()).Format(time.DateOnly) {
		t.Fatalf("a weekly cycle should start the period on Monday, got %v", from)
	}
	expect("district filter", data("GET", "/reports/notifications?district_id="+districtID(t, pool, district), nil, admin, 200)["settings"].(map[string]any),
		map[string]any{"source": "store"})
	expect("override", data("GET", "/reports/notifications?deadline_days=10", nil, admin, 200)["deadline"].(map[string]any),
		map[string]any{"days": float64(10)})

	// RF14: acknowledged receipts this month, in pieces, by district and subcounty; nothing submitted.
	hmis := data("GET", "/reports/hmis-105", nil, admin, 200)
	if hmis["integration_enabled"] != false || len(hmis["pending_decisions"].([]any)) != 3 ||
		hmis["data_elements"].(map[string]any)["105-CT11"] != "Female condoms (pieces)" {
		t.Fatalf("HMIS header: %v", hmis)
	}
	expect("HMIS total", hmis["total"].(map[string]any), map[string]any{"ct11_female_pieces": float64(100),
		"ct12_male_pieces": float64(290), "acknowledgements": float64(2), "hotspots": float64(1), "unacknowledged_lines": float64(0)})
	expect("district HMIS", data("GET", "/reports/hmis-105", nil, districtToken, 200)["total"].(map[string]any),
		map[string]any{"ct12_male_pieces": float64(290)})
	expect("other district HMIS", data("GET", "/reports/hmis-105", nil, otherDistrictToken, 200)["total"].(map[string]any),
		map[string]any{"ct12_male_pieces": float64(0), "acknowledgements": float64(0)})
	expect("earlier month", data("GET", "/reports/hmis-105?month=2020-01", nil, admin, 200)["total"].(map[string]any),
		map[string]any{"ct11_female_pieces": float64(0)})
	request("GET", "/reports/hmis-105?month=2026-13", nil, admin, 400)
}

func districtID(t *testing.T, pool *pgxpool.Pool, store string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `SELECT district_id FROM stores WHERE id = $1`, store).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// categoryOf is a product's condom category, which warehouse requests name instead of the product.
func categoryOf(t *testing.T, pool *pgxpool.Pool, product string) string {
	t.Helper()
	var category string
	if err := pool.QueryRow(context.Background(), `SELECT category FROM condoms WHERE id = $1`, product).Scan(&category); err != nil {
		t.Fatal(err)
	}
	return category
}

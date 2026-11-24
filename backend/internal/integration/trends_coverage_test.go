package integration

import (
	"context"
	"strings"
	"testing"
	"time"

	"clims-backend/internal/features/reports"

	"github.com/jackc/pgx/v5/pgxpool"
)

// testTrendsAndCoverage checks the trend and hotspot coverage reports after the order workflow: a
// trend adds up to its report's totals for the same period, bad intervals are refused, and hotspot
// coverage keeps a district account to its district.
func testTrendsAndCoverage(t *testing.T, pool *pgxpool.Pool,
	request func(string, string, any, string, int) map[string]any,
	admin, districtToken, warehouseToken, district string,
) {
	t.Helper()
	data := func(path, token string) map[string]any {
		t.Helper()
		return request("GET", path, nil, token, 200)["data"].(map[string]any)
	}
	today := time.Now().In(reports.Kampala)
	from := today.AddDate(0, 0, -6).Format(time.DateOnly)
	to := today.Format(time.DateOnly)
	period := "from=" + from + "&to=" + to

	trend := data("/reports/trends?interval=day&"+period, admin)
	buckets := trend["buckets"].([]any)
	if trend["interval"] != "day" || len(buckets) != 7 {
		t.Fatalf("a week by day should have 7 buckets: %v", trend)
	}
	var raised, requests, requested float64
	for _, item := range buckets {
		bucket := item.(map[string]any)
		raised += bucket["notifications"].(map[string]any)["raised"].(float64)
		requests += bucket["requests"].(map[string]any)["requests"].(float64)
		requested += bucket["requests"].(map[string]any)["requested_pieces"].(float64)
	}
	notifications := data("/reports/notifications?"+period, admin)
	if raised != notifications["notifications_raised"] {
		t.Fatalf("trend raised %v, report raised %v", raised, notifications["notifications_raised"])
	}
	supply := data("/reports/warehouse-requests?"+period, admin)["total"].(map[string]any)
	if requests != supply["requests"] || requested != supply["requested_pieces"] {
		t.Fatalf("trend requests %v (%v pieces), report %v", requests, requested, supply)
	}
	if raised == 0 || requests == 0 {
		t.Fatalf("the workflow raised notifications and requests this week, the trend shows none: %v", trend)
	}
	// Weeks start on Monday; the first bucket may start before the period.
	weekly := data("/reports/trends?interval=week&"+period, admin)["buckets"].([]any)
	if start, _ := time.Parse(time.DateOnly, weekly[0].(map[string]any)["start"].(string)); start.Weekday() != time.Monday {
		t.Fatalf("weekly buckets should start on Monday: %v", weekly[0])
	}
	// Without from, the period is the last six months to date, by month.
	if months := data("/reports/trends", admin); months["interval"] != "month" || len(months["buckets"].([]any)) != 6 {
		t.Fatalf("default trend: %v", months)
	}
	request("GET", "/reports/trends?interval=year", nil, admin, 400)
	request("GET", "/reports/trends?interval=day&from=2020-01-01", nil, admin, 400)

	// Hotspot coverage: everything for national users, the district for a DCFP, refused without one.
	all := data("/reports/hotspots", admin)
	var districtsTotal float64
	for _, item := range all["by_district"].([]any) {
		districtsTotal += item.(map[string]any)["total"].(float64)
	}
	if total := all["total"].(map[string]any)["total"].(float64); total == 0 || total != districtsTotal {
		t.Fatalf("hotspot total %v should equal the district rows' %v", total, districtsTotal)
	}
	own := data("/reports/hotspots", districtToken)
	ownDistrict := districtID(t, pool, district)
	for _, item := range own["by_district"].([]any) {
		if id := item.(map[string]any)["id"]; id != ownDistrict {
			t.Fatalf("a DCFP sees another district's hotspots: %v", item)
		}
	}
	request("GET", "/reports/hotspots", nil, warehouseToken, 403)
	request("GET", "/reports/hotspots?district_id=nope", nil, admin, 400)
}

// assertReportAccess checks migration 39's default grants: MOH reads everything and changes nothing,
// and the national warehouses read their reports.
func assertReportAccess(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	grants := func(role string) []string {
		var granted []string
		if err := pool.QueryRow(context.Background(), `SELECT coalesce(array_agg(p.name ORDER BY p.name), '{}')
			FROM role_permission rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
			WHERE r.name = $1`, role).Scan(&granted); err != nil {
			t.Fatal(err)
		}
		return granted
	}
	moh := strings.Join(grants("moh"), ",")
	want := "audit:read,hotspots:all_districts,hotspots:read,hotspots:read_district,inventory:read,orders:all_stores," +
		"orders:read,reports:read,roles:read,users:read"
	if moh != want {
		t.Errorf("moh has %s, want %s", moh, want)
	}
	for _, role := range []string{"nms", "jms"} {
		if !strings.Contains(","+strings.Join(grants(role), ",")+",", ",reports:read,") {
			t.Errorf("%s cannot read its reports", role)
		}
	}
}

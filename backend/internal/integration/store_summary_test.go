package integration

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"clims-backend/internal/features/stock"
)

// testStoreSummary runs last in the order workflow: it reads the warehouse's summary against the database,
// then records a delivery of two batches through POST /inventory/receipts and sees the summary follow.
func testStoreSummary(t *testing.T, pool *pgxpool.Pool,
	request func(string, string, any, string, int) map[string]any,
	admin, districtToken, warehouse, district, product, unit string,
) {
	t.Helper()
	ctx := context.Background()
	// The period is today's Kampala calendar day, cut at Kampala midnight, as the reports count.
	now := time.Now().In(stock.Kampala)
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, stock.Kampala)
	today := midnight.Format(time.DateOnly)
	summary := func(store, token string) map[string]any {
		t.Helper()
		return request("GET", "/inventory/store-summary?store_id="+store+"&from="+today+"&to="+today, nil, token, 200)["data"].(map[string]any)
	}
	row := func(s map[string]any) map[string]any {
		t.Helper()
		for _, item := range s["products"].([]any) {
			p := item.(map[string]any)
			if p["condom_id"] == product && p["unit_of_measure_id"] == unit {
				return p
			}
		}
		t.Fatalf("summary has no row for the product: %v", s["products"])
		return nil
	}
	count := func(query string, args ...any) float64 {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, query, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return float64(n)
	}

	before := summary(warehouse, admin)
	if before["store_type"] != "national" || before["store_name"] == "" {
		t.Fatalf("summary store: %v", before)
	}
	orders := before["orders"].(map[string]any)
	placed := `FROM orders o WHERE o.ordered_from_store_id = $1 AND o.hot_spot_id IS NULL AND o.order_status`
	steps := `FROM order_events e JOIN orders o ON o.id = e.order_id
		WHERE o.ordered_from_store_id = $1 AND o.hot_spot_id IS NULL AND e.created_at >= $2 AND e.action`
	for field, want := range map[string]float64{
		"to_decide":         count(`SELECT count(*) `+placed+` = 'queued'`, warehouse),
		"waiting_for_stock": count(`SELECT count(*) `+placed+` IN ('reviewed', 'on_hold')`, warehouse),
		"to_dispatch":       count(`SELECT count(*) `+placed+` = 'confirmed'`, warehouse),
		"in_transit":        count(`SELECT count(*) `+placed+` = 'dispatched'`, warehouse),
		"dispatched":        count(`SELECT count(*) `+steps+` = 'dispatch'`, warehouse, midnight),
		"rejected":          count(`SELECT count(*) `+steps+` = 'reject'`, warehouse, midnight),
	} {
		if orders[field] != want {
			t.Fatalf("summary orders: %s = %v, want %v (%v)", field, orders[field], want, orders)
		}
	}
	if orders["dispatched"] == float64(0) || orders["rejected"] == float64(0) || orders["median_days_to_dispatch"] == nil {
		t.Fatalf("the workflow dispatched and rejected orders today: %v", orders)
	}
	first := row(before)
	districtStock := row(summary(district, admin))
	warehouseReceipts := count(`SELECT coalesce(sum(quantity), 0) FROM inventory_movements
		WHERE store_id = $1 AND condom_id = $2 AND unit_of_measure_id = $3
		AND reason IN ('receipt', 'order_receipt') AND created_at >= $4`, district, product, unit, midnight)
	if warehouseReceipts == 0 || districtStock["received"] != warehouseReceipts {
		t.Fatalf("district receipts = %v, want %v including warehouse receipts", districtStock["received"], warehouseReceipts)
	}
	onHand := count(`SELECT on_hand FROM order_store_stock WHERE store_id = $1 AND condom_id = $2 AND unit_of_measure_id = $3`,
		warehouse, product, unit)
	if first["on_hand"] != onHand || first["dispatched"] == float64(0) {
		t.Fatalf("summary product: %v (on hand %v)", first, onHand)
	}

	// A delivery of two batches is saved together.
	expiry := time.Now().AddDate(1, 0, 0).Format(time.DateOnly)
	line := func(batch, expiry string, quantity int) map[string]any {
		return map[string]any{"condom_id": product, "unit_of_measure_id": unit, "batch_number": batch,
			"expiry_date": expiry, "quantity": quantity}
	}
	delivery := func(lines ...map[string]any) map[string]any {
		return map[string]any{"store_id": warehouse, "note": "Supplier delivery DN-77", "lines": lines}
	}
	saved := request("POST", "/inventory/receipts", delivery(line("SUM-001", expiry, 30), line("SUM-002", expiry, 20)), admin, 201)
	if moves := saved["data"].([]any); len(moves) != 2 || moves[1].(map[string]any)["batch_number"] != "SUM-002" ||
		moves[0].(map[string]any)["note"] != "Supplier delivery DN-77" {
		t.Fatalf("delivery movements: %v", moves)
	}
	after := row(summary(warehouse, admin))
	if after["on_hand"] != onHand+50 || after["received"] != first["received"].(float64)+50 {
		t.Fatalf("summary after a delivery of 50: %v, before %v", after, first)
	}

	// A line that fails leaves the whole delivery unsaved, and the error names the line.
	failed := request("POST", "/inventory/receipts", delivery(line("SUM-003", expiry, 5),
		map[string]any{"condom_id": product, "unit_of_measure_id": "6f0f6e8a-1d2b-4c3d-8e9f-0a1b2c3d4e5f",
			"batch_number": "SUM-004", "expiry_date": expiry, "quantity": 5}), admin, 422)
	if message, _ := failed["message"].(string); !strings.HasPrefix(message, "line 2: ") {
		t.Fatalf("failed delivery message: %v", failed)
	}
	if again := row(summary(warehouse, admin)); again["on_hand"] != after["on_hand"] {
		t.Fatalf("a failed delivery changed the stock: %v", again)
	}
	// A batch number already held under another expiry date, or given two dates in one delivery, is refused.
	later := time.Now().AddDate(2, 0, 0).Format(time.DateOnly)
	request("POST", "/inventory/receipts", delivery(line("SUM-001", later, 5)), admin, 422)
	request("POST", "/inventory/receipts", delivery(line("SUM-009", expiry, 5), line("SUM-009", later, 5)), admin, 422)
	request("POST", "/inventory/receipts", delivery(line("SUM-010", today, 5)), admin, 422)
	request("POST", "/inventory/receipts", delivery(map[string]any{"condom_id": product, "unit_of_measure_id": unit,
		"expiry_date": expiry, "quantity": 5}), admin, 422)
	request("POST", "/inventory/receipts", map[string]any{"store_id": warehouse, "lines": []any{}}, admin, 422)

	// Store staff see and receive into their own store only. Earlier checks left the DCFP role without
	// inventory permissions, so grant them: the refusals below are about the store, not the permission.
	var dfcpRole string
	if err := pool.QueryRow(ctx, `SELECT id FROM roles WHERE name = 'dfcp'`).Scan(&dfcpRole); err != nil {
		t.Fatal(err)
	}
	request("PUT", "/roles/"+dfcpRole+"/permissions", map[string]any{"permissions": []string{"orders:read", "inventory:read",
		"inventory:manage"}}, admin, 200)
	request("GET", "/inventory/store-summary?store_id="+warehouse, nil, districtToken, 403)
	request("POST", "/inventory/receipts", delivery(line("SUM-011", expiry, 5)), districtToken, 403)
	if own := summary(district, districtToken); own["store_id"] != district {
		t.Fatalf("district summary: %v", own)
	}
	request("GET", "/inventory/store-summary", nil, admin, 400)
	request("GET", "/inventory/store-summary?store_id=6f0f6e8a-1d2b-4c3d-8e9f-0a1b2c3d4e5f", nil, admin, 404)
}

package integration

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"clims-backend/internal/features/stock"
)

// testDistrictDispatch checks stock a warehouse sends to a district before it orders any: it leaves
// the warehouse's free stock first expiry first out as one dispatched order per product, all lines or
// none; the district is told and receives it like any other shipment; and request statistics leave it
// out. It runs last, after the store summary has registered fresh batches at the warehouse.
func testDistrictDispatch(t *testing.T, pool *pgxpool.Pool,
	request func(string, string, any, string, int) map[string]any,
	admin, districtToken, warehouseToken, warehouse, district, product, unit string,
) {
	t.Helper()
	ctx := context.Background()
	scalar := func(dest any, sql string, args ...any) {
		t.Helper()
		if err := pool.QueryRow(ctx, sql, args...).Scan(dest); err != nil {
			t.Fatal(err)
		}
	}
	grant := func(role string, permissions ...string) {
		t.Helper()
		var id string
		scalar(&id, `SELECT id FROM roles WHERE name = $1`, role)
		request("PUT", "/roles/"+id+"/permissions", map[string]any{"permissions": permissions}, admin, 200)
	}
	// Earlier checks changed these roles; the warehouse dispatches and the district receives.
	grant("jms", "orders:read", "orders:process")
	grant("dfcp", "orders:read", "orders:replenish", "orders:receive")

	onHand := func() int {
		t.Helper()
		var n int
		scalar(&n, `SELECT on_hand FROM order_store_stock WHERE store_id = $1 AND condom_id = $2 AND unit_of_measure_id = $3`,
			warehouse, product, unit)
		return n
	}
	var free int
	scalar(&free, `SELECT b.on_hand - b.reserved - coalesce((SELECT sum(sb.on_hand) FROM stock_batches sb
			WHERE sb.store_id = b.store_id AND sb.condom_id = b.condom_id AND sb.unit_of_measure_id = b.unit_of_measure_id
				AND sb.expiry_date < (now() AT TIME ZONE 'Africa/Kampala')::date), 0)
		FROM order_store_stock b WHERE b.store_id = $1 AND b.condom_id = $2 AND b.unit_of_measure_id = $3`, warehouse, product, unit)
	if free < 10 {
		t.Fatalf("the warehouse needs free stock for these checks; it has %d", free)
	}
	today := time.Now().In(stock.Kampala).Format(time.DateOnly) // the store summary counts Kampala days
	summary := func() map[string]any {
		t.Helper()
		return request("GET", "/inventory/store-summary?store_id="+warehouse+"&from="+today+"&to="+today, nil, admin, 200)["data"].(map[string]any)
	}
	productRow := func(s map[string]any) map[string]any {
		t.Helper()
		for _, item := range s["products"].([]any) {
			if p := item.(map[string]any); p["condom_id"] == product && p["unit_of_measure_id"] == unit {
				return p
			}
		}
		t.Fatalf("summary has no row for the product")
		return nil
	}
	var catalogueUnit *string
	scalar(&catalogueUnit, `SELECT unit_id::text FROM condoms WHERE id = $1`, product)
	if catalogueUnit == nil || *catalogueUnit != unit {
		t.Fatalf("the product's catalogue unit is %v; the warehouse holds it in %s", catalogueUnit, unit)
	}
	var requestsBefore int
	scalar(&requestsBefore, `SELECT count(*) FROM orders WHERE ordered_from_store_id = $1 AND hot_spot_id IS NULL`, warehouse)
	before := summary()
	requestReport := func() any {
		t.Helper()
		return request("GET", "/reports/warehouse-requests", nil, admin, 200)["data"].(map[string]any)["total"].(map[string]any)["requests"]
	}
	reportedBefore := requestReport()
	dispatch := func(quantity int) map[string]any {
		return map[string]any{"warehouse_store_id": warehouse, "district_store_id": district,
			"lines": []any{map[string]any{"condom_id": product, "quantity": quantity}}}
	}
	messageOf := func(body map[string]any) string {
		message, _ := body["message"].(string)
		return message
	}

	// Who may send, from where and to where.
	request("POST", "/orders/district-dispatches", dispatch(1), districtToken, 403) // without orders:process
	var otherWarehouse, otherDistrict string
	scalar(&otherWarehouse, `SELECT id FROM stores WHERE store_type = 'national' AND id <> $1 LIMIT 1`, warehouse)
	scalar(&otherDistrict, `SELECT id FROM stores WHERE store_type = 'district' AND id <> $1 LIMIT 1`, district)
	away := dispatch(1)
	away["warehouse_store_id"] = otherWarehouse
	request("POST", "/orders/district-dispatches", away, warehouseToken, 403) // not the sender's store
	fromDistrict := dispatch(1)
	fromDistrict["warehouse_store_id"] = otherDistrict
	if refused := request("POST", "/orders/district-dispatches", fromDistrict, admin, 422); refused["error"].(map[string]any)["warehouse_store_id"] == nil {
		t.Fatalf("a district store as the sender: %v", refused)
	}
	sideways := dispatch(1)
	sideways["district_store_id"] = otherWarehouse
	if refused := request("POST", "/orders/district-dispatches", sideways, admin, 422); refused["error"].(map[string]any)["district_store_id"] == nil {
		t.Fatalf("a warehouse as the destination: %v", refused)
	}
	request("POST", "/orders/district-dispatches", map[string]any{"warehouse_store_id": warehouse,
		"district_store_id": district, "lines": []any{}}, warehouseToken, 422)
	request("POST", "/orders/district-dispatches", map[string]any{"warehouse_store_id": warehouse,
		"district_store_id": district, "lines": []any{map[string]any{"condom_id": product, "quantity": 1,
			"unit_of_measure_id": unit}}}, warehouseToken, 400) // the unit is the product's own
	// Reserved and expired stock is not free to send.
	if refused := request("POST", "/orders/district-dispatches", dispatch(free+1), warehouseToken, 409); !strings.HasPrefix(messageOf(refused), "line 1: not enough free stock") {
		t.Fatalf("more than the free stock: %v", refused)
	}

	// A line that cannot go leaves the whole dispatch unsent, and the error names the line.
	failed := request("POST", "/orders/district-dispatches", map[string]any{"warehouse_store_id": warehouse,
		"district_store_id": district, "lines": []any{map[string]any{"condom_id": product, "quantity": 3},
			map[string]any{"condom_id": "6f0f6e8a-1d2b-4c3d-8e9f-0a1b2c3d4e5f", "quantity": 1}}}, warehouseToken, 422)
	if !strings.HasPrefix(messageOf(failed), "line 2: ") {
		t.Fatalf("failed second line: %v", failed)
	}
	var count int
	scalar(&count, `SELECT count(*) FROM orders WHERE ordered_from_store_id = $1 AND hot_spot_id IS NULL`, warehouse)
	if count != requestsBefore || onHand() != int(productRow(before)["on_hand"].(float64)) {
		t.Fatal("a failed dispatch created orders or moved stock")
	}

	// The warehouse sends 7 with a note and transport; the order is created dispatched.
	body := dispatch(7)
	body["note"], body["waybill_number"], body["driver_name"] = " Quarterly allocation ", "WB-900", "  "
	sent := request("POST", "/orders/district-dispatches", body, warehouseToken, 201)["data"].([]any)
	if len(sent) != 1 {
		t.Fatalf("one line, one order: %v", sent)
	}
	order := sent[0].(map[string]any)
	orderID := order["id"].(string)
	for key, want := range map[string]any{"order_status": "dispatched", "unrequested": true, "quantity_needed": float64(7),
		"quantity_approved": float64(7), "quantity_issued": float64(7), "condom_id": product, "unit_of_measure_id": unit,
		"ordered_for_store_id": district, "ordered_from_store_id": warehouse, "comment": "Quarterly allocation",
		"waybill_number": "WB-900", "driver_name": nil, "condom_category": categoryOf(t, pool, product)} {
		if order[key] != want {
			t.Fatalf("sent order: %s = %v, want %v (%v)", key, order[key], want, order)
		}
	}
	if after := onHand(); after != int(productRow(before)["on_hand"].(float64))-7 {
		t.Fatalf("warehouse on hand after sending 7: %d", after)
	}
	var shipped, expiredShipped int
	scalar(&shipped, `SELECT coalesce(sum(quantity), 0) FROM shipment_batches WHERE order_id = $1`, orderID)
	scalar(&expiredShipped, `SELECT count(*) FROM shipment_batches WHERE order_id = $1 AND expiry_date < CURRENT_DATE`, orderID)
	if shipped != 7 || expiredShipped != 0 {
		t.Fatalf("shipped batches: %d units, %d expired lines", shipped, expiredShipped)
	}
	var moved int
	scalar(&moved, `SELECT quantity FROM inventory_movements WHERE order_id = $1 AND store_id = $2 AND reason = 'dispatch'`, orderID, warehouse)
	if moved != -7 {
		t.Fatalf("ledger: %d", moved)
	}
	if events := request("GET", "/orders/"+orderID+"/events", nil, districtToken, 200)["data"].([]any); len(events) != 1 ||
		events[0].(map[string]any)["action"] != "dispatch" {
		t.Fatalf("history: %v", events)
	}

	// The district hears it is coming, without an order, with the note.
	var notified string
	for _, item := range request("GET", "/notifications?limit=100", nil, districtToken, 200)["data"].([]any) {
		if n := item.(map[string]any); n["resource_id"] == orderID && n["type"] == "order.shipment_dispatched" {
			notified = n["body"].(string)
		}
	}
	for _, part := range []string{"without an order", `Note: "Quarterly allocation".`, "Waybill WB-900"} {
		if !strings.Contains(notified, part) {
			t.Fatalf("district notification lacks %q: %q", part, notified)
		}
	}

	// Sent stock cannot be rejected; the district receives it like any shipment.
	request("POST", "/orders/"+orderID+"/actions/reject", map[string]any{"reason": "Changed our mind"}, warehouseToken, 409)
	received := request("POST", "/orders/"+orderID+"/actions/receive", map[string]any{"quantity_received": 7},
		districtToken, 200)["data"].(map[string]any)
	if received["order_status"] != "received" || received["unrequested"] != true {
		t.Fatalf("received: %v", received)
	}

	// Its quantity counts as dispatched stock, but it answered no request.
	after := summary()
	if productRow(after)["dispatched"] != productRow(before)["dispatched"].(float64)+7 {
		t.Fatalf("product dispatched: %v, before %v", productRow(after)["dispatched"], productRow(before)["dispatched"])
	}
	beforeOrders, afterOrders := before["orders"].(map[string]any), after["orders"].(map[string]any)
	for _, field := range []string{"dispatched", "in_transit", "dispatched_in_full", "median_days_to_dispatch"} {
		if afterOrders[field] != beforeOrders[field] {
			t.Fatalf("request statistics moved: %s %v -> %v", field, beforeOrders[field], afterOrders[field])
		}
	}
	if reported := requestReport(); reported != reportedBefore {
		t.Fatalf("the warehouse request report counted sent stock: %v -> %v", reportedBefore, reported)
	}
	var listed int
	scalar(&listed, `SELECT count(*) FROM orders WHERE unrequested`)
	if listed != 1 {
		t.Fatalf("unrequested orders: %d", listed)
	}

	// Stock on its way shows as incoming at the district until it is received.
	incoming := func() float64 {
		for _, item := range request("GET", "/inventory/stock?store_id="+district+"&condom_id="+product, nil, admin, 200)["data"].([]any) {
			if line := item.(map[string]any); line["unit_of_measure_id"] == unit {
				return line["incoming"].(float64)
			}
		}
		t.Fatal("the district has no balance line for the product it received")
		return 0
	}
	// Earlier checks may have left other shipments to this district on the way.
	already := incoming()
	more := request("POST", "/orders/district-dispatches", dispatch(3), warehouseToken, 201)["data"].([]any)
	if got := incoming(); got != already+3 {
		t.Fatalf("incoming while 3 more are on the way: %v, was %v", got, already)
	}
	request("POST", "/orders/"+more[0].(map[string]any)["id"].(string)+"/actions/receive",
		map[string]any{"quantity_received": 3}, districtToken, 200)
	if got := incoming(); got != already {
		t.Fatalf("incoming after receipt: %v, was %v", got, already)
	}
}

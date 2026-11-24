package integration

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"clims-backend/internal/features/stock"
)

// testBatchEdit runs after the store summary, when the district role may manage stock: the warehouse
// corrects and deletes batches through PATCH and DELETE /inventory/batches/{id}. An untouched batch's
// registration is corrected in place or erased; a batch stock has left keeps its history.
func testBatchEdit(t *testing.T, pool *pgxpool.Pool,
	request func(string, string, any, string, int) map[string]any,
	admin, districtToken, warehouse, product, unit string,
) {
	t.Helper()
	ctx := context.Background()
	year := time.Now().AddDate(1, 0, 0).Format(time.DateOnly)
	later := time.Now().AddDate(2, 0, 0).Format(time.DateOnly)
	today := time.Now().In(stock.Kampala).Format(time.DateOnly) // the store summary counts Kampala days
	scalar := func(query string, args ...any) int64 {
		t.Helper()
		var n int64
		if err := pool.QueryRow(ctx, query, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	// batch finds a batch with stock at the warehouse by number; "" is the one without a number.
	batch := func(number string) map[string]any {
		t.Helper()
		for _, item := range request("GET", "/inventory/batches?store_id="+warehouse+"&condom_id="+product, nil, admin, 200)["data"].([]any) {
			b := item.(map[string]any)
			name, _ := b["batch_number"].(string)
			if b["unit_of_measure_id"] == unit && name == number {
				return b
			}
		}
		return nil
	}
	received := func() float64 {
		t.Helper()
		for _, item := range request("GET", "/inventory/store-summary?store_id="+warehouse+"&from="+today+"&to="+today,
			nil, admin, 200)["data"].(map[string]any)["products"].([]any) {
			if p := item.(map[string]any); p["condom_id"] == product && p["unit_of_measure_id"] == unit {
				return p["received"].(float64)
			}
		}
		t.Fatal("no summary row for the product")
		return 0
	}
	// The ledger, the batches and each entry's on_hand_after still add up to the store's balance.
	reconciled := func(when string) {
		t.Helper()
		onHand := scalar(`SELECT on_hand FROM order_store_stock WHERE store_id = $1 AND condom_id = $2 AND unit_of_measure_id = $3`,
			warehouse, product, unit)
		ledger := scalar(`SELECT sum(quantity) FROM inventory_movements WHERE store_id = $1 AND condom_id = $2 AND unit_of_measure_id = $3`,
			warehouse, product, unit)
		batches := scalar(`SELECT sum(on_hand) FROM stock_batches WHERE store_id = $1 AND condom_id = $2 AND unit_of_measure_id = $3`,
			warehouse, product, unit)
		last := scalar(`SELECT on_hand_after FROM inventory_movements WHERE store_id = $1 AND condom_id = $2 AND unit_of_measure_id = $3
			ORDER BY created_at DESC, on_hand_after DESC LIMIT 1`, warehouse, product, unit)
		if ledger != onHand || batches != onHand || last != onHand {
			t.Fatalf("%s: on hand %d, ledger %d, batches %d, last on_hand_after %d", when, onHand, ledger, batches, last)
		}
	}
	edit := func(id, number, expiry string, onHand int, note string, code int) map[string]any {
		t.Helper()
		return request("PATCH", "/inventory/batches/"+id, map[string]any{"batch_number": number, "expiry_date": expiry,
			"on_hand": onHand, "note": note}, admin, code)
	}
	line := func(number, expiry string, quantity int) map[string]any {
		return map[string]any{"condom_id": product, "unit_of_measure_id": unit, "batch_number": number,
			"expiry_date": expiry, "quantity": quantity}
	}

	start := received()
	request("POST", "/inventory/receipts", map[string]any{"store_id": warehouse, "note": "DN-90",
		"lines": []any{line("EDIT-1", year, 40), line("EDIT-2", year, 10), line("EDIT-3", year, 7)}}, admin, 201)
	first := batch("EDIT-1")
	if first == nil || first["untouched"] != true || first["on_hand"] != float64(40) {
		t.Fatalf("registered batch: %v", first)
	}
	firstID := first["id"].(string)

	// Registered once and untouched: the registration itself is corrected, with no adjustment.
	edited := edit(firstID, "EDIT-1A", year, 35, "Typo on the delivery note", 200)["data"].(map[string]any)
	if edited["id"] != firstID || edited["batch_number"] != "EDIT-1A" || edited["on_hand"] != float64(35) || edited["untouched"] != true {
		t.Fatalf("edited batch: %v", edited)
	}
	if got := received(); got != start+52 {
		t.Fatalf("registered after correcting 40 to 35: %v, want %v", got, start+52)
	}
	if n := scalar(`SELECT count(*) FROM inventory_movements WHERE stock_batch_id = $1 AND quantity = 35 AND reason = 'receipt'`, firstID); n != 1 {
		t.Fatalf("corrected registration entries: %d", n)
	}
	reconciled("after correcting a registration")
	if n := scalar(`SELECT count(*) FROM audit_log WHERE action = 'inventory.batch_edited' AND target_id = $1`, firstID); n != 1 {
		t.Fatalf("batch edit audit entries: %d", n)
	}

	// Refusals.
	edit(firstID, "EDIT-1A", year, 35, "No change", 422)
	edit(firstID, "EDIT-1A", year, 35, " ", 422)
	edit(firstID, "EDIT-1A", year, 0, "Use delete", 422)
	edit(firstID, "", year, 35, "No number", 422)
	edit(firstID, "EDIT-1A", "soon", 35, "Bad date", 422)
	edit("nope", "EDIT-1A", year, 35, "Bad id", 400)
	edit("6f0f6e8a-1d2b-4c3d-8e9f-0a1b2c3d4e5f", "EDIT-1A", year, 35, "Unknown", 404)
	request("PATCH", "/inventory/batches/"+firstID, map[string]any{"batch_number": "EDIT-1A", "expiry_date": year,
		"on_hand": 34, "note": "Not my store"}, districtToken, 403)
	request("DELETE", "/inventory/batches/"+firstID, nil, districtToken, 403)
	// One batch number has one expiry date at a store.
	edit(batch("EDIT-3")["id"].(string), "EDIT-1A", later, 7, "Wrong batch", 422)

	// Renamed to a batch the store holds, the two are one batch; a later count is an adjustment.
	secondID := batch("EDIT-2")["id"].(string)
	merged := edit(secondID, "EDIT-1A", year, 10, "Same batch, mislabelled", 200)["data"].(map[string]any)
	if merged["id"] != firstID || merged["on_hand"] != float64(45) || batch("EDIT-2") != nil {
		t.Fatalf("merged batch: %v", merged)
	}
	counted := edit(firstID, "EDIT-1A", year, 44, "Counted one short", 200)["data"].(map[string]any)
	if counted["on_hand"] != float64(44) || counted["untouched"] != true {
		t.Fatalf("counted batch: %v", counted)
	}
	if n := scalar(`SELECT count(*) FROM inventory_movements WHERE stock_batch_id = $1 AND reason = 'adjustment'
		AND quantity = -1 AND note = 'Edited: Counted one short'`, firstID); n != 1 {
		t.Fatalf("count adjustment entries: %d", n)
	}
	reconciled("after a merge and a count")

	// An untouched batch is deleted as if never registered.
	thirdID := batch("EDIT-3")["id"].(string)
	before := received()
	request("DELETE", "/inventory/batches/"+thirdID, nil, admin, 200)
	if batch("EDIT-3") != nil || received() != before-7 {
		t.Fatalf("deleted batch still counted: %v, registered %v", batch("EDIT-3"), received())
	}
	if n := scalar(`SELECT count(*) FROM inventory_movements WHERE stock_batch_id = $1`, thirdID); n != 0 {
		t.Fatalf("deleted batch's ledger entries: %d", n)
	}
	reconciled("after deleting a batch")
	request("DELETE", "/inventory/batches/"+thirdID, nil, admin, 404)

	// The expired batch nothing left from goes with its expiry announcements.
	expired := batch("EXP-1")
	if expired == nil || expired["untouched"] != true {
		t.Fatalf("expired batch: %v", expired)
	}
	request("DELETE", "/inventory/batches/"+expired["id"].(string), nil, admin, 200)
	if n := scalar(`SELECT count(*) FROM notifications WHERE idempotency_key = $1`, expired["id"]); n != 0 {
		t.Fatalf("deleted batch's expiry announcements: %d", n)
	}

	// Stock left the batch without a number through dispatch: it cannot be deleted, but can be edited,
	// and its quantity changes by adjustment.
	unknown := batch("")
	if unknown == nil || unknown["untouched"] != false {
		t.Fatalf("batch stock left: %v", unknown)
	}
	unknownID := unknown["id"].(string)
	request("DELETE", "/inventory/batches/"+unknownID, nil, admin, 409)
	named := edit(unknownID, "LEGACY-1", later, int(unknown["on_hand"].(float64))+1, "Found the cartons' label", 200)["data"].(map[string]any)
	if named["batch_number"] != "LEGACY-1" || named["expiry_date"] != later || named["untouched"] != false {
		t.Fatalf("named legacy batch: %v", named)
	}
	reconciled("after naming a batch stock had left")

	// Nothing may leave less on hand than open orders reserved.
	if _, err := pool.Exec(ctx, `UPDATE order_store_stock SET reserved = on_hand WHERE store_id = $1 AND condom_id = $2
		AND unit_of_measure_id = $3`, warehouse, product, unit); err != nil {
		t.Fatal(err)
	}
	edit(firstID, "EDIT-1A", year, 40, "Short again", 409)
	request("DELETE", "/inventory/batches/"+firstID, nil, admin, 409)
	if _, err := pool.Exec(ctx, `UPDATE order_store_stock SET reserved = 0 WHERE store_id = $1 AND condom_id = $2
		AND unit_of_measure_id = $3`, warehouse, product, unit); err != nil {
		t.Fatal(err)
	}
	request("DELETE", "/inventory/batches/"+firstID, nil, admin, 200)
	reconciled("after deleting the merged batch")
}

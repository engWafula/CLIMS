package inventory

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"clims-backend/internal/features/audit"
	"clims-backend/internal/features/users"
	"clims-backend/internal/pkg/request"
	"clims-backend/internal/pkg/response"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"
)

/*
 * Editing and deleting a batch a store holds. A batch is untouched while nothing has left it or come
 * into it through an order: its stock is exactly what its own registrations and corrections add up to.
 * An untouched batch can be deleted as if it was never registered, and an untouched batch registered
 * once has its registration corrected in place. Otherwise the ledger keeps what happened: a change of
 * quantity is an adjustment, and what is left of a batch is written off with an adjustment, not deleted.
 */

var (
	errBatchNotFound = errors.New("batch not found")
	errBatchEmpty    = errors.New("this batch holds no stock")
	errBatchTouched  = errors.New("stock has already left this batch or arrived in it through an order, so it cannot be deleted; write off what is left instead")
	errNothingToEdit = errors.New("nothing to change: the batch already has this number, expiry date and quantity")
	errBatchReserved = errors.New("open orders have reserved this product's stock here, and this would leave less on hand than they need")
)

// reservedError names the batch change a reservation blocked, rather than an adjustment.
func reservedError(err error) error {
	if errors.Is(err, errBelowReserved) {
		return errBatchReserved
	}
	return err
}

// untouchedBatch is true for the batch x when its stock is exactly what the ledger entries naming it add
// up to (lm.total, from batchLedger), and no expiry exception was recorded against it. Order steps do not
// name a batch, so stock that left or arrived through an order breaks the equality.
const untouchedBatch = `(lm.total IS NOT NULL AND x.on_hand = lm.total
	AND NOT EXISTS (SELECT 1 FROM expiry_exceptions be WHERE be.stock_batch_id = x.id))`

// batchLedger totals the ledger entries naming each batch, once for a whole list.
const batchLedger = ` LEFT JOIN (SELECT stock_batch_id, sum(quantity) AS total FROM inventory_movements
	WHERE stock_batch_id IS NOT NULL GROUP BY stock_batch_id) lm ON lm.stock_batch_id = x.id`

// BatchEdit is a batch as it should be: its number, expiry date and quantity on hand, and why.
type BatchEdit struct {
	BatchNumber string `json:"batch_number"`
	// ExpiryDate is YYYY-MM-DD; a past date is allowed, since a correction can find the stock expired.
	ExpiryDate string `json:"expiry_date"`
	OnHand     int64  `json:"on_hand"`
	Note       string `json:"note"`
	expiry     time.Time
}

func validateEdit(in *BatchEdit) string {
	in.BatchNumber = strings.TrimSpace(in.BatchNumber)
	in.Note = strings.TrimSpace(in.Note)
	switch {
	case in.BatchNumber == "" || in.ExpiryDate == "":
		return "batch_number and expiry_date are required"
	case utf8.RuneCountInString(in.BatchNumber) > 60:
		return "batch_number must be at most 60 characters"
	case in.OnHand < 1 || in.OnHand > 1_000_000_000:
		return "on_hand must be between 1 and 1,000,000,000; delete the batch to remove all of it"
	case in.Note == "":
		return "a note saying why the batch is being changed is required"
	case utf8.RuneCountInString(in.Note) > 900:
		return "note must be at most 900 characters"
	}
	expiry, err := time.Parse(time.DateOnly, in.ExpiryDate)
	if err != nil {
		return "expiry_date must be a YYYY-MM-DD date"
	}
	in.expiry = expiry
	return ""
}

func (h *Handler) editBatch(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	var in BatchEdit
	if err := request.DecodeJSON(c, &in); err != nil {
		return response.Error(c, 400, "invalid request body", nil)
	}
	if message := validateEdit(&in); message != "" {
		return response.Error(c, 422, message, nil)
	}
	user := users.CurrentUser(c)
	batchID, err := h.repo.editBatch(c.Context(), scopeFor(user), user.ID, id, in)
	if err != nil {
		return inventoryError(c, err)
	}
	batches, err := h.repo.batches(c.Context(), scopeFor(user), StockFilter{BatchID: &batchID}, time.Now())
	if err != nil || len(batches) != 1 {
		return inventoryError(c, errors.Join(err, errors.New("edited batch not found")))
	}
	return response.Success(c, 200, "batch updated", batches[0])
}

func (h *Handler) deleteBatch(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	user := users.CurrentUser(c)
	if err := h.repo.deleteBatch(c.Context(), scopeFor(user), id); err != nil {
		return inventoryError(c, err)
	}
	return response.Success(c, 200, "batch deleted", nil)
}

// heldBatch is a batch locked for a change.
type heldBatch struct {
	id, storeID, condomID, unitID string
	number                        *string
	expiry                        *time.Time
	onHand                        int64
	untouched                     bool
	// receiptID is its one ledger entry when it is untouched and was registered once.
	receiptID *string
}

// lockBatch locks a batch with stock at a store the user may change. It locks the store's balance for
// the batch's product and unit first, the order every other stock write takes (dispatch, delivery,
// receipt), so a correction racing a dispatch waits for it instead of deadlocking. A batch's store,
// product and unit never change, so reading them before the lock is safe.
func lockBatch(ctx context.Context, tx pgx.Tx, access scope, id string) (heldBatch, error) {
	b := heldBatch{id: id}
	err := tx.QueryRow(ctx, `SELECT store_id, condom_id, unit_of_measure_id FROM stock_batches WHERE id = $1`, id).
		Scan(&b.storeID, &b.condomID, &b.unitID)
	if errors.Is(err, pgx.ErrNoRows) {
		return b, errBatchNotFound
	}
	if err != nil {
		return b, err
	}
	if !access.allStores && (access.storeID == nil || *access.storeID != b.storeID) {
		return b, errForbidden
	}
	if _, err := tx.Exec(ctx, `SELECT 1 FROM order_store_stock
		WHERE store_id = $1 AND condom_id = $2 AND unit_of_measure_id = $3 FOR UPDATE`,
		b.storeID, b.condomID, b.unitID); err != nil {
		return b, err
	}
	err = tx.QueryRow(ctx, `SELECT batch_number, expiry_date, on_hand FROM stock_batches WHERE id = $1 FOR UPDATE`, id).
		Scan(&b.number, &b.expiry, &b.onHand)
	if errors.Is(err, pgx.ErrNoRows) { // deleted while this waited
		return b, errBatchNotFound
	}
	if err != nil {
		return b, err
	}
	if b.onHand == 0 {
		return b, errBatchEmpty
	}
	var entries int
	var onlyReceipt *string
	if err := tx.QueryRow(ctx, `SELECT `+untouchedBatch+`,
			(SELECT count(*) FROM inventory_movements bm WHERE bm.stock_batch_id = x.id),
			(SELECT min(bm.id::text) FROM inventory_movements bm WHERE bm.stock_batch_id = x.id AND bm.reason = 'receipt')
		FROM stock_batches x
		LEFT JOIN LATERAL (SELECT sum(quantity) AS total FROM inventory_movements WHERE stock_batch_id = x.id) lm ON true
		WHERE x.id = $1`, id).Scan(&b.untouched, &entries, &onlyReceipt); err != nil {
		return b, err
	}
	if b.untouched && entries == 1 {
		b.receiptID = onlyReceipt
	}
	return b, nil
}

// moveBalance changes the store's total for the batch's product and unit, never below what open orders
// have reserved.
func moveBalance(ctx context.Context, tx pgx.Tx, b heldBatch, delta int64) error {
	tag, err := tx.Exec(ctx, `UPDATE order_store_stock SET on_hand = on_hand + $4, updated_at = CURRENT_TIMESTAMP
		WHERE store_id = $1 AND condom_id = $2 AND unit_of_measure_id = $3 AND on_hand + $4 >= reserved`,
		b.storeID, b.condomID, b.unitID, delta)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errBelowReserved
	}
	return nil
}

// shiftLater moves on_hand_after by delta on the store's ledger entries for the product and unit that came
// after the entry id, whose quantity changed or which was removed. Entries of one delivery share a time;
// among them, a later line of the same product holds more.
func shiftLater(ctx context.Context, tx pgx.Tx, b heldBatch, id string, delta int64) error {
	_, err := tx.Exec(ctx, `UPDATE inventory_movements m SET on_hand_after = m.on_hand_after + $5
		FROM inventory_movements e
		WHERE e.id = $4 AND m.id <> e.id AND m.store_id = $1 AND m.condom_id = $2 AND m.unit_of_measure_id = $3
			AND (m.created_at > e.created_at OR (m.created_at = e.created_at AND m.on_hand_after > e.on_hand_after))`,
		b.storeID, b.condomID, b.unitID, id, delta)
	return err
}

// forgetExpiryAlerts removes a batch's expiry announcements once its expiry date changed or it is gone,
// so a corrected date is announced afresh.
func forgetExpiryAlerts(ctx context.Context, tx pgx.Tx, batchID string) error {
	_, err := tx.Exec(ctx, `DELETE FROM notifications WHERE idempotency_key = $1 AND type IN ($2, $3)`,
		batchID, BatchExpiring, BatchExpired)
	return err
}

func dateText(day *time.Time) *string {
	if day == nil {
		return nil
	}
	text := day.Format(time.DateOnly)
	return &text
}

// editBatch corrects a batch's number, expiry date and quantity, and returns the batch that holds the
// stock afterwards: renamed to a batch the store already holds, the two are one batch.
func (r *Repository) editBatch(ctx context.Context, access scope, actorID, id string, in BatchEdit) (string, error) {
	resultID := id
	err := pgx.BeginFunc(ctx, r.db, func(tx pgx.Tx) error {
		b, err := lockBatch(ctx, tx, access, id)
		if err != nil {
			return err
		}
		renamed := b.number == nil || *b.number != in.BatchNumber
		redated := b.expiry == nil || !b.expiry.Equal(in.expiry)
		delta := in.OnHand - b.onHand
		if !renamed && !redated && delta == 0 {
			return errNothingToEdit
		}
		merged := false
		if renamed || redated {
			// One batch number has one expiry date at a store, as on a delivery.
			var other bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM stock_batches
				WHERE store_id = $1 AND condom_id = $2 AND unit_of_measure_id = $3 AND batch_number = $4
					AND expiry_date IS DISTINCT FROM $5::date AND on_hand > 0 AND id <> $6)`,
				b.storeID, b.condomID, b.unitID, in.BatchNumber, in.expiry, id).Scan(&other); err != nil {
				return err
			}
			if other {
				return errBatchExpiry
			}
			var target string
			err := tx.QueryRow(ctx, `SELECT id FROM stock_batches
				WHERE store_id = $1 AND condom_id = $2 AND unit_of_measure_id = $3 AND batch_number = $4
					AND expiry_date = $5 AND id <> $6 FOR UPDATE`,
				b.storeID, b.condomID, b.unitID, in.BatchNumber, in.expiry, id).Scan(&target)
			switch {
			case errors.Is(err, pgx.ErrNoRows):
				if _, err := tx.Exec(ctx, `UPDATE stock_batches SET batch_number = $2, expiry_date = $3,
					updated_at = CURRENT_TIMESTAMP WHERE id = $1`, id, in.BatchNumber, in.expiry); err != nil {
					return err
				}
			case err != nil:
				return err
			default:
				// The store already holds this batch: the stock and its history join it.
				merged, resultID = true, target
				if _, err := tx.Exec(ctx, `UPDATE stock_batches SET on_hand = on_hand + $2, updated_at = CURRENT_TIMESTAMP
					WHERE id = $1`, target, b.onHand); err != nil {
					return err
				}
				for _, statement := range []string{
					`UPDATE inventory_movements SET stock_batch_id = $2 WHERE stock_batch_id = $1`,
					`UPDATE expiry_exceptions SET stock_batch_id = $2 WHERE stock_batch_id = $1`,
				} {
					if _, err := tx.Exec(ctx, statement, id, target); err != nil {
						return err
					}
				}
				if _, err := tx.Exec(ctx, `DELETE FROM stock_batches WHERE id = $1`, id); err != nil {
					return err
				}
			}
			if redated {
				if err := forgetExpiryAlerts(ctx, tx, id); err != nil {
					return err
				}
			}
		}
		if delta != 0 {
			if b.receiptID != nil && !merged {
				// Registered once and untouched: the registration itself was wrong.
				if err := moveBalance(ctx, tx, b, delta); err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `UPDATE stock_batches SET on_hand = $2, updated_at = CURRENT_TIMESTAMP
					WHERE id = $1`, id, in.OnHand); err != nil {
					return err
				}
				if err := shiftLater(ctx, tx, b, *b.receiptID, delta); err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `UPDATE inventory_movements SET quantity = quantity + $2,
					on_hand_after = on_hand_after + $2 WHERE id = $1`, *b.receiptID, delta); err != nil {
					return err
				}
			} else {
				note := "Edited: " + in.Note
				expiry := in.expiry
				if _, err := r.recordIn(ctx, tx, actorID, MovementInput{StoreID: b.storeID, CondomID: b.condomID,
					UnitOfMeasureID: b.unitID, Reason: "adjustment", Quantity: delta, Note: &note,
					BatchNumber: &in.BatchNumber, ExpiryDate: &in.ExpiryDate, expiry: &expiry}); err != nil {
					return err
				}
			}
		}
		changes := map[string]audit.Change{}
		if renamed {
			changes["batch_number"] = audit.Change{Before: b.number, After: in.BatchNumber}
		}
		if redated {
			changes["expiry_date"] = audit.Change{Before: dateText(b.expiry), After: in.ExpiryDate}
		}
		if delta != 0 {
			changes["on_hand"] = audit.Change{Before: b.onHand, After: in.OnHand}
		}
		details := map[string]any{"note": in.Note, "registration_corrected": delta != 0 && b.receiptID != nil && !merged}
		if merged {
			details["merged_into"] = resultID
		}
		return r.audit.Record(ctx, tx, audit.Entry{Action: "inventory.batch_edited",
			Target:  &audit.Subject{Type: "stock_batch", ID: id},
			Related: []audit.Subject{{Type: "store", ID: b.storeID}, {Type: "product", ID: b.condomID}},
			Changes: changes, Details: details})
	})
	return resultID, reservedError(err)
}

// deleteBatch removes an untouched batch as if it was never registered: its stock, its ledger entries and
// its expiry announcements. A product left with no stock, history or batches at the store goes too.
func (r *Repository) deleteBatch(ctx context.Context, access scope, id string) error {
	return reservedError(pgx.BeginFunc(ctx, r.db, func(tx pgx.Tx) error {
		b, err := lockBatch(ctx, tx, access, id)
		if err != nil {
			return err
		}
		if !b.untouched {
			return errBatchTouched
		}
		if err := moveBalance(ctx, tx, b, -b.onHand); err != nil {
			return err
		}
		// Latest first, so an earlier entry's place in the ledger is read before anything shifts it.
		rows, err := tx.Query(ctx, `SELECT id, quantity FROM inventory_movements WHERE stock_batch_id = $1
			ORDER BY created_at DESC, on_hand_after DESC`, id)
		if err != nil {
			return err
		}
		type entry struct {
			id       string
			quantity int64
		}
		entries, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (entry, error) {
			var e entry
			err := row.Scan(&e.id, &e.quantity)
			return e, err
		})
		if err != nil {
			return err
		}
		for _, e := range entries {
			if err := shiftLater(ctx, tx, b, e.id, -e.quantity); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `DELETE FROM inventory_movements WHERE id = $1`, e.id); err != nil {
				return err
			}
		}
		if err := forgetExpiryAlerts(ctx, tx, id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM stock_batches WHERE id = $1`, id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM order_store_stock o
			WHERE o.store_id = $1 AND o.condom_id = $2 AND o.unit_of_measure_id = $3 AND o.on_hand = 0 AND o.reserved = 0
				AND NOT EXISTS (SELECT 1 FROM stock_batches x WHERE x.store_id = o.store_id AND x.condom_id = o.condom_id
					AND x.unit_of_measure_id = o.unit_of_measure_id)
				AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.store_id = o.store_id
					AND m.condom_id = o.condom_id AND m.unit_of_measure_id = o.unit_of_measure_id)`,
			b.storeID, b.condomID, b.unitID); err != nil {
			return err
		}
		return r.audit.Record(ctx, tx, audit.Entry{Action: "inventory.batch_deleted",
			Target:  &audit.Subject{Type: "stock_batch", ID: id},
			Related: []audit.Subject{{Type: "store", ID: b.storeID}, {Type: "product", ID: b.condomID}},
			Details: map[string]any{"batch_number": b.number, "expiry_date": dateText(b.expiry),
				"unit_of_measure_id": b.unitID, "quantity": b.onHand, "ledger_entries_removed": len(entries)}})
	}))
}

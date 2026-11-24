// Package stock holds the batch rules every stock change follows (reporting requirements v0.2, RF16):
// stock leaves a store first-expiry-first-out, expired stock never leaves, and a batch with under one
// calendar month left leaves only with a documented exception. The six and three month dispatch
// targets are proposals awaiting approval, so they are reported, not enforced.
package stock

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// RuleVersion names the expiry rules applied, recorded with every exception.
const RuleVersion = "reporting-requirements-0.2-draft"

var (
	// ErrShort means the store's unexpired batches cannot cover the quantity.
	ErrShort = errors.New("not enough unexpired stock in the store's batches")
	// ErrNearExpiry means a batch with under one month left would be used without an exception reason.
	ErrNearExpiry = errors.New("stock expiring within one month needs expiry_exception_reason")
	// ErrBatchShort means the named batch holds less than the quantity to remove.
	ErrBatchShort = errors.New("the batch holds less than the quantity to remove")
)

// Kampala is the reporting time zone; Uganda keeps East Africa Time all year.
var Kampala = time.FixedZone("EAT", 3*60*60)

// Today is the current calendar date in Kampala, as a UTC midnight for date comparisons.
func Today(now time.Time) time.Time {
	local := now.In(Kampala)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
}

// NearExpiry reports whether a batch expiring on expiry has under one calendar month left on today.
func NearExpiry(expiry, today time.Time) bool {
	return expiry.Before(today.AddDate(0, 1, 0))
}

// ExpiringMonths is when a batch starts to count as expiring: under this many calendar months left. The
// store's stock managers are told once (inventory.ExpiryAlerts).
const ExpiringMonths = 3

// Band classifies a batch by shelf life left, in calendar months: expired, under_1_month (red, needs an
// exception to leave), under_3_months, under_6_months, ok, or unknown when the expiry is not recorded.
func Band(expiry *time.Time, today time.Time) string {
	switch {
	case expiry == nil:
		return "unknown"
	case expiry.Before(today):
		return "expired"
	case NearExpiry(*expiry, today):
		return "under_1_month"
	case expiry.Before(today.AddDate(0, ExpiringMonths, 0)):
		return "under_3_months"
	case expiry.Before(today.AddDate(0, 6, 0)):
		return "under_6_months"
	}
	return "ok"
}

// Taken is a quantity taken from one batch.
type Taken struct {
	BatchID  string
	Number   *string
	Expiry   *time.Time
	Quantity int64
	// DaysRemaining is the shelf life left on the day it was taken; nil for unknown expiry.
	DaysRemaining *int
	NearExpiry    bool
}

// Take removes quantity from a store's batches, earliest expiry first and unknown expiry last, skipping
// expired batches. Any batch with under one month left needs an exception reason.
func Take(ctx context.Context, tx pgx.Tx, storeID, condomID, unitID string, quantity int64, today time.Time, exception *string) ([]Taken, error) {
	rows, err := tx.Query(ctx, `SELECT id, batch_number, expiry_date, on_hand FROM stock_batches
		WHERE store_id = $1 AND condom_id = $2 AND unit_of_measure_id = $3 AND on_hand > 0
			AND (expiry_date IS NULL OR expiry_date >= $4)
		ORDER BY expiry_date NULLS LAST, created_at, id FOR UPDATE`, storeID, condomID, unitID, today)
	if err != nil {
		return nil, err
	}
	type batch struct {
		id     string
		number *string
		expiry *time.Time
		onHand int64
	}
	batches, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (batch, error) {
		var b batch
		err := row.Scan(&b.id, &b.number, &b.expiry, &b.onHand)
		return b, err
	})
	if err != nil {
		return nil, err
	}
	var taken []Taken
	remaining := quantity
	for _, b := range batches {
		if remaining == 0 {
			break
		}
		amount := min(remaining, b.onHand)
		t := Taken{BatchID: b.id, Number: b.number, Expiry: b.expiry, Quantity: amount}
		if b.expiry != nil {
			days := int(b.expiry.Sub(today).Hours() / 24)
			t.DaysRemaining = &days
			t.NearExpiry = NearExpiry(*b.expiry, today)
		}
		if t.NearExpiry && exception == nil {
			return nil, ErrNearExpiry
		}
		taken = append(taken, t)
		remaining -= amount
	}
	if remaining > 0 {
		return nil, ErrShort
	}
	for _, t := range taken {
		if _, err := tx.Exec(ctx, `UPDATE stock_batches SET on_hand = on_hand - $2, updated_at = CURRENT_TIMESTAMP
			WHERE id = $1`, t.BatchID, t.Quantity); err != nil {
			return nil, err
		}
	}
	return taken, nil
}

// Add puts quantity into a store's batch, creating it. The store's total row must already exist.
func Add(ctx context.Context, tx pgx.Tx, storeID, condomID, unitID string, number *string, expiry *time.Time, quantity int64) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `INSERT INTO stock_batches (store_id, condom_id, unit_of_measure_id, batch_number, expiry_date, on_hand)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (store_id, condom_id, unit_of_measure_id, coalesce(batch_number, ''), coalesce(expiry_date, 'infinity'::date))
		DO UPDATE SET on_hand = stock_batches.on_hand + EXCLUDED.on_hand, updated_at = CURRENT_TIMESTAMP
		RETURNING id`, storeID, condomID, unitID, number, expiry, quantity).Scan(&id)
	return id, err
}

// Remove takes quantity out of one named batch, for a counted correction.
func Remove(ctx context.Context, tx pgx.Tx, storeID, condomID, unitID string, number *string, expiry *time.Time, quantity int64) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `UPDATE stock_batches SET on_hand = on_hand - $6, updated_at = CURRENT_TIMESTAMP
		WHERE store_id = $1 AND condom_id = $2 AND unit_of_measure_id = $3
			AND coalesce(batch_number, '') = coalesce($4, '') AND coalesce(expiry_date, 'infinity'::date) = coalesce($5::date, 'infinity'::date)
			AND on_hand >= $6
		RETURNING id`, storeID, condomID, unitID, number, expiry, quantity).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrBatchShort
	}
	return id, err
}

// Ship records what left a store per batch, for a warehouse shipment or a hotspot delivery line, and
// any expiry exceptions with who authorised them. Exactly one of orderID and lineID is set; deliveryID
// goes with lineID.
func Ship(ctx context.Context, tx pgx.Tx, taken []Taken, orderID, lineID, deliveryID *string, actorID string, exception *string) error {
	for _, t := range taken {
		if _, err := tx.Exec(ctx, `INSERT INTO shipment_batches (order_id, hotspot_delivery_line_id, batch_number, expiry_date, quantity, days_remaining)
			VALUES ($1, $2, $3, $4, $5, $6)`, orderID, lineID, t.Number, t.Expiry, t.Quantity, t.DaysRemaining); err != nil {
			return err
		}
		if !t.NearExpiry {
			continue
		}
		if _, err := tx.Exec(ctx, `INSERT INTO expiry_exceptions (stock_batch_id, order_id, hotspot_delivery_id, authorized_by_id,
				reason, quantity, expiry_date, days_remaining, rule_version)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, t.BatchID, orderID, deliveryID, actorID, *exception, t.Quantity,
			t.Expiry, *t.DaysRemaining, RuleVersion); err != nil {
			return err
		}
	}
	return nil
}

// Shipped is one batch line a warehouse shipped on an order.
type Shipped struct {
	Number   *string
	Expiry   *time.Time
	Quantity int64
}

// Receive puts what a district counted on arrival into its batches, as the warehouse shipped them. A
// shortfall comes off the latest-expiring lines; a surplus, or a shipment from before batches were
// recorded, goes to an unknown-expiry batch for review.
func Receive(ctx context.Context, tx pgx.Tx, storeID, condomID, unitID, orderID string, received int64) error {
	rows, err := tx.Query(ctx, `SELECT batch_number, expiry_date, quantity FROM shipment_batches
		WHERE order_id = $1 ORDER BY expiry_date NULLS LAST, created_at, id`, orderID)
	if err != nil {
		return err
	}
	shipped, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Shipped, error) {
		var s Shipped
		err := row.Scan(&s.Number, &s.Expiry, &s.Quantity)
		return s, err
	})
	if err != nil {
		return err
	}
	for _, s := range Allocate(shipped, received) {
		if _, err := Add(ctx, tx, storeID, condomID, unitID, s.Number, s.Expiry, s.Quantity); err != nil {
			return err
		}
	}
	return nil
}

// Allocate splits a received quantity over the shipped lines in order, so a shortfall falls on the last
// (latest-expiring) lines and any surplus becomes an unknown-expiry line.
func Allocate(shipped []Shipped, received int64) []Shipped {
	var out []Shipped
	remaining := received
	for _, s := range shipped {
		if remaining == 0 {
			break
		}
		amount := min(remaining, s.Quantity)
		out = append(out, Shipped{Number: s.Number, Expiry: s.Expiry, Quantity: amount})
		remaining -= amount
	}
	if remaining > 0 {
		out = append(out, Shipped{Quantity: remaining})
	}
	return out
}

// ExpiredQuantity is SQL for the expired stock in the order_store_stock row aliased b on date $today.
func ExpiredQuantity(today string) string {
	return `coalesce((SELECT sum(sb.on_hand) FROM stock_batches sb WHERE sb.store_id = b.store_id
		AND sb.condom_id = b.condom_id AND sb.unit_of_measure_id = b.unit_of_measure_id
		AND sb.expiry_date < ` + today + `), 0)`
}

package orders

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"clims-backend/internal/features/stock"
	"clims-backend/internal/features/users"
	"clims-backend/internal/pkg/request"
	"clims-backend/internal/pkg/response"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	errNotDistrict = errors.New("district_store_id must name a district store")
	errNoFreeStock = errors.New("not enough free stock: on hand less reserved and expired stock does not cover it")
)

// maxDispatchLines bounds one dispatch; each line becomes an order.
const maxDispatchLines = 20

// DistrictDispatchInput sends stock from a national warehouse to a district store before it orders
// any: one line per product, with the shipment's note and transport shared by every line.
type DistrictDispatchInput struct {
	WarehouseID     string                 `json:"warehouse_store_id"`
	DistrictStoreID string                 `json:"district_store_id"`
	Lines           []DistrictDispatchLine `json:"lines"`
	// Note is the warehouse's word to the district, e.g. why the stock is sent.
	Note                  *string `json:"note"`
	ExpiryExceptionReason *string `json:"expiry_exception_reason"`
	WaybillNumber         *string `json:"waybill_number"`
	VehicleRegistration   *string `json:"vehicle_registration"`
	DriverName            *string `json:"driver_name"`
	DriverPhone           *string `json:"driver_phone"`
}

// DistrictDispatchLine is a product and how much of it, counted in the product's catalogue unit.
type DistrictDispatchLine struct {
	CondomID string `json:"condom_id"`
	Quantity int32  `json:"quantity"`
}

// lineError names the line a dispatch failed on; errors.Is still sees the cause.
type lineError struct {
	line int
	err  error
}

func (e lineError) Error() string { return fmt.Sprintf("line %d: %s", e.line, e.err) }
func (e lineError) Unwrap() error { return e.err }

// districtDispatch sends stock to a district store without a request from it. Every line leaves
// first expiry first out and becomes an order created dispatched; the district receives each one.
func (h *Handler) districtDispatch(c fiber.Ctx) error {
	var input DistrictDispatchInput
	if err := request.DecodeJSON(c, &input); err != nil {
		return response.Error(c, 400, "invalid request body", nil)
	}
	if field, message := validDistrictDispatch(&input); message != "" {
		var fields map[string]string
		if field != "" {
			fields = map[string]string{field: message}
		}
		return response.Error(c, 422, message, fields)
	}
	created, err := h.repo.dispatchToDistrict(c.Context(), scopeFor(users.CurrentUser(c)), input)
	if err != nil {
		if errors.Is(err, errNotDistrict) {
			return response.Error(c, 422, err.Error(), map[string]string{"district_store_id": err.Error()})
		}
		if errors.Is(err, errNoFreeStock) {
			return response.Error(c, 409, err.Error(), nil)
		}
		if message := lineMessage(err); message != "" {
			return response.Error(c, 422, message, nil)
		}
		return workflowError(c, err)
	}
	return response.Success(c, 201, "dispatched to the district; it records the receipt when the stock arrives", created)
}

// lineMessage names the line for the failures workflowError and orderError answer with a fixed
// message, which would drop the `line N:` the client relies on; "" for every other error.
func lineMessage(err error) string {
	var failed lineError
	if !errors.As(err, &failed) {
		return ""
	}
	var dbError *pgconn.PgError
	switch {
	case errors.Is(err, errInactiveProduct):
		return fmt.Sprintf("line %d: this product is inactive and cannot be sent", failed.line)
	case errors.As(err, &dbError) && dbError.Code == "23503":
		return fmt.Sprintf("line %d: a referenced store, product or unit does not exist", failed.line)
	case errors.As(err, &dbError) && dbError.Code == "23514":
		return fmt.Sprintf("line %d: the order's quantities do not fit together", failed.line)
	}
	return ""
}

// validDistrictDispatch normalises the input and names the first problem, with the field it is
// about when there is one, or returns "" when the dispatch can be tried.
func validDistrictDispatch(in *DistrictDispatchInput) (string, string) {
	for _, field := range []struct {
		name  string
		value *string
	}{{"warehouse_store_id", &in.WarehouseID}, {"district_store_id", &in.DistrictStoreID}} {
		id, err := request.ParseUUID(*field.value)
		if err != nil {
			return field.name, "provide the " + field.name + " UUID"
		}
		*field.value = id
	}
	if in.WarehouseID == in.DistrictStoreID {
		return "district_store_id", errNotDistrict.Error()
	}
	if len(in.Lines) == 0 || len(in.Lines) > maxDispatchLines {
		return "lines", fmt.Sprintf("a dispatch needs between 1 and %d lines", maxDispatchLines)
	}
	seen := make(map[string]int, len(in.Lines))
	for i := range in.Lines {
		line := &in.Lines[i]
		id, err := request.ParseUUID(line.CondomID)
		if err != nil {
			return "", fmt.Sprintf("line %d: provide the condom_id UUID", i+1)
		}
		line.CondomID = id
		if first, repeated := seen[id]; repeated {
			return "", fmt.Sprintf("line %d: the product is already on line %d; put its whole quantity on one line", i+1, first)
		}
		seen[id] = i + 1
		if line.Quantity < 1 || line.Quantity > 10_000_000 {
			return "", fmt.Sprintf("line %d: quantity must be a whole number from 1 to 10000000", i+1)
		}
	}
	var ok bool
	if in.Note, ok = trimComment(in.Note); !ok {
		return "note", "note must be at most 4000 characters"
	}
	if !validExceptionReason(&in.ExpiryExceptionReason) {
		return "expiry_exception_reason", "expiry_exception_reason must be at most 1000 characters"
	}
	for _, field := range []struct {
		name  string
		value **string
		limit int
	}{{"waybill_number", &in.WaybillNumber, 100}, {"vehicle_registration", &in.VehicleRegistration, 30},
		{"driver_name", &in.DriverName, 200}, {"driver_phone", &in.DriverPhone, 30}} {
		if *field.value == nil {
			continue
		}
		// Transport is optional: blank counts as not given.
		trimmed := strings.TrimSpace(**field.value)
		if utf8.RuneCountInString(trimmed) > field.limit {
			return field.name, fmt.Sprintf("%s must be at most %d characters", field.name, field.limit)
		}
		*field.value = &trimmed
		if trimmed == "" {
			*field.value = nil
		}
	}
	return "", ""
}

// dispatchToDistrict creates one dispatched order per line, taking each product's free stock at the
// warehouse first expiry first out, all or nothing. The district's receivers are told of each.
func (r *Repository) dispatchToDistrict(ctx context.Context, access scope, input DistrictDispatchInput) ([]Order, error) {
	if !access.allStores && !assigned(access.storeID, input.WarehouseID) {
		return nil, errWorkflowForbidden
	}
	today := stock.Today(time.Now())
	created := make([]Order, 0, len(input.Lines))
	err := pgx.BeginFunc(ctx, r.db, func(tx pgx.Tx) error {
		storeType := func(id string) (string, error) {
			var kind string
			err := tx.QueryRow(ctx, `SELECT store_type FROM stores WHERE id = $1`, id).Scan(&kind)
			if errors.Is(err, pgx.ErrNoRows) {
				return "", nil
			}
			return kind, err
		}
		if kind, err := storeType(input.WarehouseID); err != nil {
			return err
		} else if kind != "national" {
			return errNotWarehouse
		}
		if kind, err := storeType(input.DistrictStoreID); err != nil {
			return err
		} else if kind != "district" {
			return errNotDistrict
		}
		for i, line := range input.Lines {
			order, err := r.dispatchLine(ctx, tx, access.userID, input, line, today)
			if err != nil {
				return lineError{line: i + 1, err: err}
			}
			created = append(created, order)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return created, nil
}

// dispatchLine sends one product: the order is created dispatched in the product's catalogue unit,
// the free stock comes off the warehouse's balance and batches, and the step is recorded.
func (r *Repository) dispatchLine(ctx context.Context, tx pgx.Tx, actorID string, input DistrictDispatchInput,
	line DistrictDispatchLine, today time.Time,
) (Order, error) {
	if err := checkOrderable(ctx, tx, line.CondomID); err != nil {
		return Order{}, err
	}
	var category, unitID *string
	err := tx.QueryRow(ctx, `SELECT category, unit_id FROM condoms WHERE id = $1`, line.CondomID).Scan(&category, &unitID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Order{}, errUnknownProduct
	}
	if err != nil {
		return Order{}, err
	}
	if unitID == nil {
		return Order{}, errProductUnit
	}
	order, err := scanOrder(tx.QueryRow(ctx, `INSERT INTO orders (condom_id, condom_category, unit_of_measure_id,
			quantity_needed, quantity_approved, quantity_issued, ordered_by_id, handled_by_id, ordered_for_store_id,
			ordered_from_store_id, order_status, comment, waybill_number, vehicle_registration, driver_name,
			driver_phone, unrequested)
		VALUES ($1, $2, $3, $4, $4, $4, $5, $5, $6, $7, 'dispatched', $8, $9, $10, $11, $12, true)
		RETURNING `+columns, line.CondomID, category, *unitID, line.Quantity, actorID, input.DistrictStoreID,
		input.WarehouseID, input.Note, input.WaybillNumber, input.VehicleRegistration, input.DriverName, input.DriverPhone))
	if err != nil {
		return Order{}, err
	}
	// Only free stock goes: what district orders have reserved stays for them, and expired stock stays behind.
	var onHand int64
	err = tx.QueryRow(ctx, `UPDATE order_store_stock b SET on_hand = on_hand - $4, updated_at = CURRENT_TIMESTAMP
		WHERE store_id = $1 AND condom_id = $2 AND unit_of_measure_id = $3
			AND on_hand - reserved - `+stock.ExpiredQuantity("$5::date")+` >= $4
		RETURNING on_hand`, input.WarehouseID, line.CondomID, *unitID, line.Quantity, today).Scan(&onHand)
	if errors.Is(err, pgx.ErrNoRows) {
		return Order{}, errNoFreeStock
	}
	if err != nil {
		return Order{}, err
	}
	taken, err := stock.Take(ctx, tx, input.WarehouseID, line.CondomID, *unitID, int64(line.Quantity), today,
		input.ExpiryExceptionReason)
	if errors.Is(err, stock.ErrShort) {
		return Order{}, errExpiredStock
	}
	if err != nil {
		return Order{}, err
	}
	if err = stock.Ship(ctx, tx, taken, &order.ID, nil, nil, actorID, input.ExpiryExceptionReason); err != nil {
		return Order{}, err
	}
	if err = recordMovement(ctx, tx, order, input.WarehouseID, "dispatch", -int64(line.Quantity), onHand, actorID); err != nil {
		return Order{}, err
	}
	return order, r.record(ctx, tx, nil, order, actorID, "dispatch")
}

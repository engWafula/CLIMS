package reports

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// SupplyFilter narrows the warehouse request and stock reports.
type SupplyFilter struct {
	Filter
	WarehouseID *string
	StoreID     *string
	StoreType   string
}

// piecesOf converts a quantity of an order or ledger line to pieces, or NULL when the line is not in
// the product's catalogue unit or the product has no pieces per unit (reported as unconverted).
func piecesOf(quantity, unit string) string {
	return `CASE WHEN c.pieces_per_unit IS NOT NULL AND ` + unit + ` = c.unit_id THEN ` + quantity + `::bigint * c.pieces_per_unit END`
}

// requestsCTE is every warehouse request the user may see that matches the filter: a district's order
// to a national warehouse. Stock a warehouse sent without an order is not a request. Parameters: $1 all, $2 store, $3 from, $4 to, $5 warehouse, $6 district,
// $7 category, $8 store_id (either side of the request).
var requestsCTE = `WITH q AS (
	SELECT o.id, o.condom_id, coalesce(o.condom_category, c.category) AS category, o.unit_of_measure_id, o.order_status, o.created_at,
		o.ordered_from_store_id AS warehouse_id, fs.name AS warehouse, o.ordered_for_store_id AS district_store_id,
		ts.name AS district_store, ts.district_id, d.name AS district,
		o.quantity_needed AS requested,
		-- A rejected request approved nothing, even when it was rejected after review.
		CASE WHEN o.order_status <> 'rejected' THEN coalesce(o.quantity_approved,
			CASE WHEN o.order_status NOT IN ('queued') THEN o.quantity_needed END) END AS approved,
		o.quantity_issued AS issued, o.quantity_received AS received,
		` + piecesOf("o.quantity_needed", "o.unit_of_measure_id") + ` AS requested_pieces,
		` + piecesOf("CASE WHEN o.order_status <> 'rejected' THEN coalesce(o.quantity_approved, CASE WHEN o.order_status NOT IN ('queued') THEN o.quantity_needed END) END", "o.unit_of_measure_id") + ` AS approved_pieces,
		` + piecesOf("o.quantity_issued", "o.unit_of_measure_id") + ` AS issued_pieces,
		` + piecesOf("o.quantity_received", "o.unit_of_measure_id") + ` AS received_pieces,
		(SELECT max(e.created_at) FROM order_events e WHERE e.order_id = o.id AND e.action = 'receive') AS received_at
	FROM orders o
	LEFT JOIN condoms c ON c.id = o.condom_id
	JOIN stores fs ON fs.id = o.ordered_from_store_id AND fs.store_type = 'national'
	JOIN stores ts ON ts.id = o.ordered_for_store_id AND ts.store_type = 'district'
	LEFT JOIN districts d ON d.id = ts.district_id
	WHERE o.hot_spot_id IS NULL AND NOT o.unrequested AND o.order_status NOT IN ('pending', 'fulfilled')
		AND ($1::boolean OR $2::uuid IN (o.ordered_from_store_id, o.ordered_for_store_id))
		AND o.created_at >= $3 AND o.created_at < $4
		AND ($5::uuid IS NULL OR o.ordered_from_store_id = $5) AND ($6::uuid IS NULL OR ts.district_id = $6)
		AND ($7 = '' OR coalesce(o.condom_category, c.category) = $7)
		AND ($8::uuid IS NULL OR $8 IN (o.ordered_from_store_id, o.ordered_for_store_id)))`

func (f SupplyFilter) requestArgs(s scope) []any {
	// orders.created_at is a timestamp without time zone holding UTC. pgx sends a time to such a column
	// as its wall clock, dropping the zone, so Kampala midnight must go as UTC or the period is cut 3 hours late.
	return []any{s.all, s.storeID, f.From.UTC(), f.To.UTC(), f.WarehouseID, f.DistrictID, f.Category, f.StoreID}
}

// RequestTotals are the RF06 quantities for a group of warehouse requests. Pieces count only requests
// in the product's catalogue unit; the rest are counted in Unconverted.
type RequestTotals struct {
	Requests           int64    `json:"requests"`
	RequestedPieces    int64    `json:"requested_pieces"`
	ApprovedPieces     int64    `json:"approved_pieces"`
	IssuedPieces       int64    `json:"issued_pieces"`
	AcknowledgedPieces int64    `json:"acknowledged_pieces"`
	QuantityFulfilment *float64 `json:"quantity_fulfilment_rate"`
	FullyReceived      int64    `json:"fully_received"`
	PartlyReceived     int64    `json:"partly_received"`
	// Pending requests are still open: neither received nor rejected.
	Pending int64 `json:"pending"`
	// Rejected requests were closed by the warehouse; they still count as requested.
	Rejected int64 `json:"rejected"`
	// Unconverted requests name a product but are in another unit than its catalogue unit, or the
	// product has no pieces per unit: a data quality issue.
	Unconverted int64 `json:"unconverted"`
	// AwaitingUnit requests name only a category and a number; the warehouse picks the product, and
	// with it the unit, at review. They are left out of the piece totals until then, and are not a
	// quality issue.
	AwaitingUnit int64 `json:"awaiting_unit"`
}

// totalsSQL aggregates q into RequestTotals' columns, in order.
const totalsSQL = `count(*), coalesce(sum(requested_pieces), 0), coalesce(sum(approved_pieces), 0),
	coalesce(sum(issued_pieces), 0), coalesce(sum(received_pieces) FILTER (WHERE requested_pieces IS NOT NULL), 0),
	count(*) FILTER (WHERE received IS NOT NULL AND received >= requested),
	count(*) FILTER (WHERE received IS NOT NULL AND received < requested),
	count(*) FILTER (WHERE received IS NULL AND order_status <> 'rejected'),
	count(*) FILTER (WHERE order_status = 'rejected'),
	count(*) FILTER (WHERE requested_pieces IS NULL AND condom_id IS NOT NULL),
	count(*) FILTER (WHERE condom_id IS NULL)`

func scanTotals(row pgx.Row, t *RequestTotals, extra ...any) error {
	dest := append(extra, &t.Requests, &t.RequestedPieces, &t.ApprovedPieces, &t.IssuedPieces, &t.AcknowledgedPieces,
		&t.FullyReceived, &t.PartlyReceived, &t.Pending, &t.Rejected, &t.Unconverted, &t.AwaitingUnit)
	if err := row.Scan(dest...); err != nil {
		return err
	}
	t.QuantityFulfilment = rate(t.AcknowledgedPieces, t.RequestedPieces)
	return nil
}

type RequestGroup struct {
	ID   *string `json:"id"`
	Name *string `json:"name"`
	RequestTotals
}

// SupplyReport is the warehouse supply report: district requests to national warehouses raised in the
// period, by condom type, warehouse and district (RF06).
type SupplyReport struct {
	Period        Period           `json:"period"`
	DataUpdatedAt time.Time        `json:"data_updated_at"`
	Total         RequestTotals    `json:"total"`
	ByType        []RequestGroup   `json:"by_type"`
	ByWarehouse   []RequestGroup   `json:"by_warehouse"`
	ByDistrict    []RequestGroup   `json:"by_district"`
	Response      ResponseDuration `json:"response"`
	// WithoutRequest is the stock warehouses sent to districts in the period without a request
	// (district dispatches). It is not part of the request totals or the fulfilment rate.
	WithoutRequest UnrequestedDispatches `json:"dispatches_without_request"`
}

// UnrequestedDispatches are warehouse dispatches to districts that no district asked for, in pieces.
type UnrequestedDispatches struct {
	Dispatches     int64 `json:"dispatches"`
	IssuedPieces   int64 `json:"issued_pieces"`
	ReceivedPieces int64 `json:"received_pieces"`
	// AwaitingReceipt is dispatches the district has not received yet.
	AwaitingReceipt int64 `json:"awaiting_receipt"`
}

// unrequestedCTE selects district dispatches with the same scope and filters as requestsCTE.
var unrequestedCTE = func() string {
	out := strings.Replace(requestsCTE, "AND NOT o.unrequested AND", "AND o.unrequested AND", 1)
	if out == requestsCTE {
		panic("reports: requestsCTE no longer filters unrequested orders")
	}
	return out
}()

func (r *Repository) supplyReport(ctx context.Context, s scope, f SupplyFilter, now time.Time) (SupplyReport, error) {
	args := f.requestArgs(s)
	out := SupplyReport{Period: periodOf(f.Filter), DataUpdatedAt: now}
	if err := scanTotals(r.db.QueryRow(ctx, requestsCTE+` SELECT `+totalsSQL+` FROM q`, args...), &out.Total); err != nil {
		return SupplyReport{}, err
	}
	if err := r.db.QueryRow(ctx, requestsCTE+`
		SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM received_at - created_at) / 3600)
				FILTER (WHERE received_at IS NOT NULL),
			count(*) FILTER (WHERE received_at IS NOT NULL),
			extract(epoch FROM now() - min(created_at) FILTER (WHERE received_at IS NULL AND order_status <> 'rejected')) / 3600
		FROM q`, args...).Scan(&out.Response.MedianHours, &out.Response.FulfilledIncluded,
		&out.Response.OldestPendingHours); err != nil {
		return SupplyReport{}, err
	}
	out.Response.Pending = out.Total.Pending
	groups := func(id, name string) ([]RequestGroup, error) {
		rows, err := r.db.Query(ctx, requestsCTE+` SELECT `+id+`, `+name+`, `+totalsSQL+` FROM q
			GROUP BY 1, 2 ORDER BY 2 NULLS LAST`, args...)
		if err != nil {
			return nil, err
		}
		return pgx.CollectRows(rows, func(row pgx.CollectableRow) (RequestGroup, error) {
			var g RequestGroup
			err := scanTotals(row, &g.RequestTotals, &g.ID, &g.Name)
			return g, err
		})
	}
	var err error
	if err = r.db.QueryRow(ctx, unrequestedCTE+`
		SELECT count(*), coalesce(sum(issued_pieces), 0), coalesce(sum(received_pieces), 0),
			count(*) FILTER (WHERE received IS NULL AND order_status <> 'rejected')
		FROM q`, args...).Scan(&out.WithoutRequest.Dispatches, &out.WithoutRequest.IssuedPieces,
		&out.WithoutRequest.ReceivedPieces, &out.WithoutRequest.AwaitingReceipt); err != nil {
		return SupplyReport{}, err
	}
	if out.ByType, err = groups("category", "initcap(category)"); err != nil {
		return SupplyReport{}, err
	}
	if out.ByWarehouse, err = groups("warehouse_id::text", "warehouse"); err != nil {
		return SupplyReport{}, err
	}
	out.ByDistrict, err = groups("district_id::text", "district")
	return out, err
}

// RequestRecord is one warehouse request behind the supply totals.
type RequestRecord struct {
	ID              string     `json:"id"`
	CondomID        *string    `json:"condom_id"`
	Category        *string    `json:"category"`
	UnitOfMeasureID *string    `json:"unit_of_measure_id"`
	Status          string     `json:"order_status"`
	CreatedAt       time.Time  `json:"created_at"`
	WarehouseID     string     `json:"warehouse_store_id"`
	Warehouse       string     `json:"warehouse"`
	DistrictStoreID string     `json:"district_store_id"`
	DistrictStore   string     `json:"district_store"`
	DistrictID      *string    `json:"district_id"`
	District        *string    `json:"district"`
	Requested       *int32     `json:"requested"`
	Approved        *int32     `json:"approved"`
	Issued          *int32     `json:"issued"`
	Received        *int32     `json:"received"`
	RequestedPieces *int64     `json:"requested_pieces"`
	ApprovedPieces  *int64     `json:"approved_pieces"`
	IssuedPieces    *int64     `json:"issued_pieces"`
	ReceivedPieces  *int64     `json:"received_pieces"`
	ReceivedAt      *time.Time `json:"received_at"`
	ResponseHours   *float64   `json:"response_hours"`
}

func (r *Repository) requestRecords(ctx context.Context, s scope, f SupplyFilter) ([]RequestRecord, error) {
	rows, err := r.db.Query(ctx, requestsCTE+`
		SELECT id, condom_id, category, unit_of_measure_id, order_status, created_at, warehouse_id, warehouse,
			district_store_id, district_store, district_id, district, requested, approved, issued, received,
			requested_pieces, approved_pieces, issued_pieces, received_pieces, received_at,
			extract(epoch FROM received_at - created_at) / 3600
		FROM q ORDER BY created_at DESC, id DESC LIMIT $9 OFFSET $10`, append(f.requestArgs(s), f.Limit, f.Offset)...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[RequestRecord])
}

func periodOf(f Filter) Period {
	return Period{From: f.From.In(Kampala).Format(time.DateOnly), To: f.To.In(Kampala).AddDate(0, 0, -1).Format(time.DateOnly)}
}

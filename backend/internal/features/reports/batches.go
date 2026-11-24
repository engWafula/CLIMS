package reports

import (
	"context"
	"time"

	"clims-backend/internal/features/stock"

	"github.com/jackc/pgx/v5"
)

// BatchLine is one batch held at a store, with its shelf life left (RF10, RF16).
type BatchLine struct {
	ID              string     `json:"id"`
	StoreID         string     `json:"store_id"`
	Store           string     `json:"store"`
	StoreType       string     `json:"store_type"`
	DistrictID      *string    `json:"district_id"`
	CondomID        string     `json:"condom_id"`
	Product         string     `json:"product"`
	Category        *string    `json:"category"`
	UnitOfMeasureID string     `json:"unit_of_measure_id"`
	Unit            string     `json:"unit"`
	BatchNumber     *string    `json:"batch_number"`
	ExpiryDate      *time.Time `json:"expiry_date"`
	DaysRemaining   *int       `json:"days_remaining"`
	Band            string     `json:"band"`
	OnHand          int64      `json:"on_hand"`
	Pieces          *int64     `json:"pieces"`
}

// BatchReport lists batches in stock, earliest expiry first, with the expiry bands of the draft rules.
type BatchReport struct {
	StockDate   time.Time   `json:"stock_date"`
	RuleVersion string      `json:"rule_version"`
	Lines       []BatchLine `json:"lines"`
}

const productSQL = `concat_ws(' ', (SELECT pb.name FROM brands pb WHERE pb.id = c.brand_id),
	(SELECT pt.name FROM product_types pt WHERE pt.id = c.type_id),
	CASE c.category WHEN 'male' THEN 'Male' WHEN 'female' THEN 'Female' END)`

func (r *Repository) batchReport(ctx context.Context, s scope, f SupplyFilter, band string, now time.Time) (BatchReport, error) {
	today := stock.Today(now)
	out := BatchReport{StockDate: now, RuleVersion: stock.RuleVersion, Lines: []BatchLine{}}
	rows, err := r.db.Query(ctx, `SELECT sb.id, sb.store_id, s.name, s.store_type, s.district_id, sb.condom_id, `+productSQL+`,
			c.category, sb.unit_of_measure_id, um.name, sb.batch_number, sb.expiry_date, sb.on_hand,
			CASE WHEN c.pieces_per_unit IS NOT NULL AND sb.unit_of_measure_id = c.unit_id THEN sb.on_hand * c.pieces_per_unit END
		FROM stock_batches sb
		JOIN stores s ON s.id = sb.store_id
		JOIN condoms c ON c.id = sb.condom_id
		JOIN unit_of_measures um ON um.id = sb.unit_of_measure_id
		WHERE sb.on_hand > 0 AND ($1::boolean OR sb.store_id = $2::uuid)
			AND ($3::uuid IS NULL OR sb.store_id = $3) AND ($4 = '' OR s.store_type = $4)
			AND ($5::uuid IS NULL OR s.district_id = $5) AND ($6 = '' OR c.category = $6)
		ORDER BY sb.expiry_date NULLS LAST, s.name, sb.id`,
		s.all, s.storeID, f.StoreID, f.StoreType, f.DistrictID, f.Category)
	if err != nil {
		return BatchReport{}, err
	}
	lines, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (BatchLine, error) {
		var l BatchLine
		err := row.Scan(&l.ID, &l.StoreID, &l.Store, &l.StoreType, &l.DistrictID, &l.CondomID, &l.Product, &l.Category,
			&l.UnitOfMeasureID, &l.Unit, &l.BatchNumber, &l.ExpiryDate, &l.OnHand, &l.Pieces)
		l.Band = stock.Band(l.ExpiryDate, today)
		if l.ExpiryDate != nil {
			days := int(l.ExpiryDate.Sub(today).Hours() / 24)
			l.DaysRemaining = &days
		}
		return l, err
	})
	if err != nil {
		return BatchReport{}, err
	}
	for _, l := range lines {
		if band == "" || l.Band == band {
			out.Lines = append(out.Lines, l)
		}
	}
	return out, nil
}

// ExpiryException is a batch with under one month left that left a store, with who authorised it and why.
type ExpiryException struct {
	ID                string    `json:"id"`
	CreatedAt         time.Time `json:"created_at"`
	StoreID           string    `json:"store_id"`
	Store             string    `json:"store"`
	CondomID          string    `json:"condom_id"`
	Product           string    `json:"product"`
	BatchNumber       *string   `json:"batch_number"`
	ExpiryDate        time.Time `json:"expiry_date"`
	DaysRemaining     int       `json:"days_remaining"`
	Quantity          int32     `json:"quantity"`
	Reason            string    `json:"reason"`
	AuthorizedByID    *string   `json:"authorized_by_id"`
	AuthorizedBy      *string   `json:"authorized_by"`
	RuleVersion       string    `json:"rule_version"`
	OrderID           *string   `json:"order_id"`
	HotspotDeliveryID *string   `json:"hotspot_delivery_id"`
}

func (r *Repository) expiryExceptions(ctx context.Context, s scope, f SupplyFilter) ([]ExpiryException, error) {
	rows, err := r.db.Query(ctx, `SELECT e.id, e.created_at, sb.store_id, s.name, sb.condom_id, `+productSQL+`,
			sb.batch_number, e.expiry_date, e.days_remaining, e.quantity, e.reason, e.authorized_by_id,
			nullif(btrim(concat_ws(' ', u.firstname, u.lastname)), ''), e.rule_version, e.order_id, e.hotspot_delivery_id
		FROM expiry_exceptions e
		JOIN stock_batches sb ON sb.id = e.stock_batch_id
		JOIN stores s ON s.id = sb.store_id
		JOIN condoms c ON c.id = sb.condom_id
		LEFT JOIN users u ON u.id = e.authorized_by_id
		WHERE ($1::boolean OR sb.store_id = $2::uuid) AND e.created_at >= $3 AND e.created_at < $4
			AND ($5::uuid IS NULL OR sb.store_id = $5) AND ($6 = '' OR c.category = $6)
			AND ($9 = '' OR s.store_type = $9) AND ($10::uuid IS NULL OR s.district_id = $10)
		ORDER BY e.created_at DESC, e.id DESC LIMIT $7 OFFSET $8`,
		s.all, s.storeID, f.From, f.To, f.StoreID, f.Category, f.Limit, f.Offset, f.StoreType, f.DistrictID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[ExpiryException])
}

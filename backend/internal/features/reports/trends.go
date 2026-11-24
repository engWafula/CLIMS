package reports

import (
	"context"
	"errors"
	"time"
)

// Trend intervals. Weeks start on Monday (ISO), months on the 1st, both in Kampala time.
const (
	IntervalDay   = "day"
	IntervalWeek  = "week"
	IntervalMonth = "month"
)

// maxBuckets keeps a trend readable and its queries small; a longer span needs a wider interval.
const maxBuckets = 400

// TrendNotifications are the hotspot stockout notifications raised in a bucket, followed as a cohort:
// fulfilled and rejected count those raised in the bucket, as the notification report does.
type TrendNotifications struct {
	Raised              int64    `json:"raised"`
	Fulfilled           int64    `json:"fulfilled"`
	Rejected            int64    `json:"rejected"`
	FulfilmentRate      *float64 `json:"fulfilment_rate"`
	MedianResponseHours *float64 `json:"median_response_hours"`
}

// TrendRequests are the district requests to national warehouses raised in a bucket, in pieces.
type TrendRequests struct {
	Requests           int64 `json:"requests"`
	RequestedPieces    int64 `json:"requested_pieces"`
	ApprovedPieces     int64 `json:"approved_pieces"`
	IssuedPieces       int64 `json:"issued_pieces"`
	AcknowledgedPieces int64 `json:"acknowledged_pieces"`
}

// TrendDeliveries are the district deliveries to hotspots made in a bucket, in pieces, with what the
// hotspot managers have acknowledged of them so far.
type TrendDeliveries struct {
	Deliveries         int64 `json:"deliveries"`
	MalePieces         int64 `json:"male_pieces"`
	FemalePieces       int64 `json:"female_pieces"`
	AcknowledgedPieces int64 `json:"acknowledged_pieces"`
}

// TrendStock is the movement of stock through the stores in a bucket, in pieces. Quantities held in
// another unit than the product's catalogue unit cannot be converted and are left out.
type TrendStock struct {
	// Received from suppliers (receipts and opening balances).
	ReceivedPieces int64 `json:"received_pieces"`
	// Dispatched by national warehouses to districts.
	DispatchedPieces int64 `json:"dispatched_pieces"`
	// Received by district stores from national warehouses.
	DistrictReceivedPieces int64 `json:"district_received_pieces"`
	// Delivered by district stores to hotspots.
	DeliveredPieces int64 `json:"delivered_pieces"`
	// Net adjustments (counts, losses, write-offs).
	AdjustedPieces int64 `json:"adjusted_pieces"`
}

type TrendBucket struct {
	// Start is the first Kampala day of the bucket (YYYY-MM-DD). The first and last buckets can be
	// partial: only days inside the period are counted.
	Start         string             `json:"start"`
	Notifications TrendNotifications `json:"notifications"`
	Requests      TrendRequests      `json:"requests"`
	Deliveries    TrendDeliveries    `json:"deliveries"`
	Stock         TrendStock         `json:"stock"`
}

type TrendReport struct {
	Period        Period        `json:"period"`
	Interval      string        `json:"interval"`
	DataUpdatedAt time.Time     `json:"data_updated_at"`
	Buckets       []TrendBucket `json:"buckets"`
}

var errInterval = errors.New("interval must be day, week or month")

// bucketStart is the start of the bucket holding the Kampala day `day`.
func bucketStart(day time.Time, interval string) time.Time {
	switch interval {
	case IntervalMonth:
		return time.Date(day.Year(), day.Month(), 1, 0, 0, 0, 0, Kampala)
	case IntervalWeek:
		offset := (int(day.Weekday()) + 6) % 7 // days since Monday
		return time.Date(day.Year(), day.Month(), day.Day()-offset, 0, 0, 0, 0, Kampala)
	default:
		return time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, Kampala)
	}
}

func nextBucket(start time.Time, interval string) time.Time {
	switch interval {
	case IntervalMonth:
		return start.AddDate(0, 1, 0)
	case IntervalWeek:
		return start.AddDate(0, 0, 7)
	default:
		return start.AddDate(0, 0, 1)
	}
}

// TrendBuckets lists the bucket starts covering [from, to), to is exclusive, or an error when there
// would be more than maxBuckets.
func TrendBuckets(from, to time.Time, interval string) ([]string, error) {
	switch interval {
	case IntervalDay, IntervalWeek, IntervalMonth:
	default:
		return nil, errInterval
	}
	var out []string
	for start := bucketStart(from.In(Kampala), interval); start.Before(to); start = nextBucket(start, interval) {
		if len(out) == maxBuckets {
			return nil, errors.New("the period has too many buckets for this interval; choose a wider interval")
		}
		out = append(out, start.Format(time.DateOnly))
	}
	return out, nil
}

// DefaultInterval picks a readable interval for a period: days up to a month, weeks up to about a
// quarter, months beyond.
func DefaultInterval(from, to time.Time) string {
	days := to.Sub(from).Hours() / 24
	switch {
	case days <= 31:
		return IntervalDay
	case days <= 92:
		return IntervalWeek
	default:
		return IntervalMonth
	}
}

// kampalaBucket is SQL for the bucket start of a timestamp with time zone, as YYYY-MM-DD; $unit is the
// parameter holding the interval. Uganda keeps UTC+3 all year.
func kampalaBucket(column, unit string) string {
	return `to_char(date_trunc(` + unit + `::text, (` + column + ` AT TIME ZONE 'UTC') + interval '3 hours'), 'YYYY-MM-DD')`
}

// utcBucket is the same for a timestamp without time zone that holds UTC (orders.created_at).
func utcBucket(column, unit string) string {
	return `to_char(date_trunc(` + unit + `::text, ` + column + ` + interval '3 hours'), 'YYYY-MM-DD')`
}

// trendReport counts each measure per bucket. The notification and request measures use the same
// records, scope and filters as their reports, so a trend adds up to the report total for its period.
func (r *Repository) trendReport(ctx context.Context, s scope, f SupplyFilter, interval string, now time.Time) (TrendReport, error) {
	starts, err := TrendBuckets(f.From, f.To, interval)
	if err != nil {
		return TrendReport{}, err
	}
	out := TrendReport{
		Period:        periodOf(f.Filter),
		Interval:      interval,
		DataUpdatedAt: now,
		Buckets:       make([]TrendBucket, len(starts)),
	}
	index := make(map[string]*TrendBucket, len(starts))
	for i, start := range starts {
		out.Buckets[i].Start = start
		index[start] = &out.Buckets[i]
	}
	at := func(key string) *TrendBucket {
		if b, ok := index[key]; ok {
			return b
		}
		return &TrendBucket{} // outside the period (cannot happen with the period filters); dropped
	}

	// Notifications, by the day they were first raised.
	nargs := append(s.args(f.Filter), f.From, f.To, interval)
	rows, err := r.db.Query(ctx, notificationsCTE+`
		SELECT `+kampalaBucket("created_at", "$11")+`, count(*),
			count(*) FILTER (WHERE status = 'fulfilled'), count(*) FILTER (WHERE status = 'rejected'),
			percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM fulfilled_at - created_at) / 3600)
				FILTER (WHERE fulfilled_at IS NOT NULL)
		FROM n WHERE created_at >= $9 AND created_at < $10 GROUP BY 1`, nargs...)
	if err != nil {
		return TrendReport{}, err
	}
	for rows.Next() {
		var key string
		var n TrendNotifications
		if err := rows.Scan(&key, &n.Raised, &n.Fulfilled, &n.Rejected, &n.MedianResponseHours); err != nil {
			rows.Close()
			return TrendReport{}, err
		}
		n.FulfilmentRate = rate(n.Fulfilled, n.Raised)
		at(key).Notifications = n
	}
	if err := rows.Err(); err != nil {
		return TrendReport{}, err
	}

	// Warehouse requests, by the day they were placed.
	rargs := append(f.requestArgs(s), interval)
	rows, err = r.db.Query(ctx, requestsCTE+`
		SELECT `+utcBucket("created_at", "$9")+`, count(*), coalesce(sum(requested_pieces), 0),
			coalesce(sum(approved_pieces), 0), coalesce(sum(issued_pieces), 0),
			coalesce(sum(received_pieces) FILTER (WHERE requested_pieces IS NOT NULL), 0)
		FROM q GROUP BY 1`, rargs...)
	if err != nil {
		return TrendReport{}, err
	}
	for rows.Next() {
		var key string
		var q TrendRequests
		if err := rows.Scan(&key, &q.Requests, &q.RequestedPieces, &q.ApprovedPieces, &q.IssuedPieces,
			&q.AcknowledgedPieces); err != nil {
			rows.Close()
			return TrendReport{}, err
		}
		at(key).Requests = q
	}
	if err := rows.Err(); err != nil {
		return TrendReport{}, err
	}

	// Deliveries to hotspots, by the day they were recorded, seen through their notification.
	rows, err = r.db.Query(ctx, `
		SELECT `+kampalaBucket("d.created_at", "$11")+`, count(DISTINCT d.id),
			coalesce(sum(l.pieces) FILTER (WHERE l.category = 'male'), 0),
			coalesce(sum(l.pieces) FILTER (WHERE l.category = 'female'), 0),
			coalesce(sum(l.acknowledged_pieces), 0)
		FROM hotspot_deliveries d
		JOIN hotspot_delivery_lines l ON l.delivery_id = d.id
		JOIN stockout_reports r ON r.id = d.stockout_report_id
		JOIN hot_spots h ON h.id = r.hot_spot_id
		WHERE ($1::boolean OR r.district_store_id = $2::uuid OR d.district_store_id = $2::uuid
				OR r.hot_spot_id = $3::uuid OR r.reported_by_id = $4::uuid OR h.district_id = $5::uuid)
			AND ($6::uuid IS NULL OR h.district_id = $6) AND ($7::uuid IS NULL OR r.hot_spot_id = $7)
			AND ($8 = '' OR l.category = $8)
			AND d.created_at >= $9 AND d.created_at < $10
		GROUP BY 1`, nargs...)
	if err != nil {
		return TrendReport{}, err
	}
	for rows.Next() {
		var key string
		var d TrendDeliveries
		if err := rows.Scan(&key, &d.Deliveries, &d.MalePieces, &d.FemalePieces, &d.AcknowledgedPieces); err != nil {
			rows.Close()
			return TrendReport{}, err
		}
		at(key).Deliveries = d
	}
	if err := rows.Err(); err != nil {
		return TrendReport{}, err
	}

	// Stock movements at the stores the user may see, in pieces.
	pieces := `CASE WHEN c.pieces_per_unit IS NOT NULL AND m.unit_of_measure_id = c.unit_id
		THEN m.quantity * c.pieces_per_unit END`
	rows, err = r.db.Query(ctx, `
		SELECT `+kampalaBucket("m.created_at", "$9")+`,
			coalesce(sum(`+pieces+`) FILTER (WHERE m.reason IN ('receipt', 'opening')), 0),
			coalesce(-sum(`+pieces+`) FILTER (WHERE m.reason = 'dispatch'), 0),
			coalesce(sum(`+pieces+`) FILTER (WHERE m.reason = 'order_receipt'), 0),
			coalesce(-sum(`+pieces+`) FILTER (WHERE m.reason = 'hotspot_delivery'), 0),
			coalesce(sum(`+pieces+`) FILTER (WHERE m.reason = 'adjustment'), 0)
		FROM inventory_movements m
		JOIN stores s ON s.id = m.store_id
		JOIN condoms c ON c.id = m.condom_id
		WHERE ($1::boolean OR m.store_id = $2::uuid)
			AND m.created_at >= $3 AND m.created_at < $4
			AND ($5::uuid IS NULL OR m.store_id = $5) AND ($6 = '' OR s.store_type = $6)
			AND ($7::uuid IS NULL OR s.district_id = $7) AND ($8 = '' OR c.category = $8)
		GROUP BY 1`, s.all, s.storeID, f.From, f.To, f.StoreID, f.StoreType, f.DistrictID, f.Category, interval)
	if err != nil {
		return TrendReport{}, err
	}
	for rows.Next() {
		var key string
		var m TrendStock
		if err := rows.Scan(&key, &m.ReceivedPieces, &m.DispatchedPieces, &m.DistrictReceivedPieces,
			&m.DeliveredPieces, &m.AdjustedPieces); err != nil {
			rows.Close()
			return TrendReport{}, err
		}
		at(key).Stock = m
	}
	return out, rows.Err()
}

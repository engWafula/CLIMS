package reports

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"clims-backend/internal/features/stock"
	"clims-backend/internal/features/users"
)

// exportLimit caps the rows one export or version holds.
// shortcut: exports are built in memory; stream them if a report ever needs more rows than this.
const exportLimit = 50000

var errTooManyRows = fmt.Errorf("the report has more than %d rows; narrow the filters", exportLimit)

// errInvalid marks a filter the user got wrong (400), as opposed to a failure on our side (500).
type errInvalid struct{ error }

func (e errInvalid) Unwrap() error { return e.error }

// Column is one exported column: the row field and its plain-language header.
type Column struct {
	Key    string `json:"key"`
	Header string `json:"header"`
}

// Table is a report exactly as exported and as saved in a version (RF15): the rows behind the screen,
// with the period, data update time, scope, product, rule version and the definitions that apply.
type Table struct {
	Report        string            `json:"report"`
	Title         string            `json:"title"`
	Period        string            `json:"period"`
	DataUpdatedAt time.Time         `json:"data_updated_at"`
	Scope         string            `json:"scope"`
	Product       string            `json:"product"`
	RuleVersion   string            `json:"rule_version"`
	Filters       map[string]string `json:"filters"`
	Definitions   []string          `json:"definitions"`
	Columns       []Column          `json:"columns"`
	Rows          []map[string]any  `json:"rows"`
}

// blankRule distinguishes blank data from genuine zeros in every export (RF15).
const blankRule = "A blank cell means not applicable or not recorded; 0 is a recorded zero. Times are Africa/Kampala."

// filterKeys are the parameters a report may be exported or saved with.
var filterKeys = map[string]bool{"from": true, "to": true, "category": true, "district_id": true, "hot_spot_id": true,
	"deadline_days": true, "target_percent": true, "status": true, "store_type": true, "warehouse_store_id": true,
	"store_id": true, "band": true, "month": true}

func cols(pairs ...string) []Column {
	out := make([]Column, 0, len(pairs)/2)
	for i := 0; i < len(pairs); i += 2 {
		out = append(out, Column{Key: pairs[i], Header: pairs[i+1]})
	}
	return out
}

var exportColumns = map[string][]Column{
	"notifications": cols("id", "Notification ID", "hot_spot", "Hotspot", "district", "District", "selection", "Selection",
		"status", "Status", "raised_at", "Raised", "repeat_count", "Repeated messages", "delivered_male_pieces",
		"Male pieces delivered", "delivered_female_pieces", "Female pieces delivered", "received_male_pieces",
		"Male pieces acknowledged", "received_female_pieces", "Female pieces acknowledged", "fulfilled_at", "Fulfilled",
		"response_hours", "Response hours", "acknowledgement_overdue", "Acknowledgement overdue"),
	"warehouse-requests": cols("id", "Request ID", "created_at", "Requested", "district_store", "District store", "district",
		"District", "warehouse", "Warehouse", "category", "Type", "order_status", "Status", "requested_pieces",
		"Requested pieces", "approved_pieces", "Approved pieces", "issued_pieces", "Issued pieces", "received_pieces",
		"Acknowledged pieces", "received_at", "Acknowledged", "response_hours", "Response hours"),
	"stock": cols("store", "Store", "store_type", "Store type", "district", "District", "product", "Product", "category", "Type",
		"unit", "Unit", "physical", "Physical", "reserved", "Reserved", "usable", "Usable", "in_transit", "In transit",
		"expired", "Expired", "unknown_expiry", "Unknown expiry", "physical_pieces", "Physical pieces", "usable_pieces",
		"Usable pieces", "average_monthly_issues", "Average monthly issues", "months_of_stock", "Months of stock",
		"coverage_status", "Coverage", "reconciled", "Reconciled"),
	"batches": cols("store", "Store", "store_type", "Store type", "product", "Product", "category", "Type", "unit", "Unit",
		"batch_number", "Batch", "expiry_date", "Expiry date", "days_remaining", "Days remaining", "band", "Expiry band",
		"on_hand", "On hand", "pieces", "Pieces"),
	"expiry-exceptions": cols("created_at", "Shipped", "store", "Store", "product", "Product", "batch_number", "Batch",
		"expiry_date", "Expiry date", "days_remaining", "Days remaining", "quantity", "Quantity", "reason", "Reason",
		"authorized_by", "Authorised by", "rule_version", "Rule version", "order_id", "Warehouse request",
		"hotspot_delivery_id", "Hotspot delivery"),
	"hmis-105": cols("district", "District", "subcounty", "Subcounty", "ct11_female_pieces", "105-CT11 Female condoms (pieces)",
		"ct12_male_pieces", "105-CT12 Male condoms (pieces)", "acknowledgements", "Acknowledgements", "hotspots", "Hotspots",
		"unacknowledged_lines", "Unacknowledged lines (not counted)"),
}

var exportTitles = map[string]string{"notifications": "Notification fulfilment", "warehouse-requests": "Warehouse requests",
	"stock": "Store stock", "batches": "Batches and expiry", "expiry-exceptions": "Expiry exceptions", "hmis-105": "HMIS 105 readiness"}

var exportDefinitions = map[string][]string{
	"notifications": {"Notifications raised in the period, counted once each; repeats are shown, not counted again.",
		"Fulfilled: the hotspot manager acknowledged a positive receipt for every selected type by the data update time.",
		"Response hours: from the notification being raised to the last acknowledgement needed."},
	"warehouse-requests": {"Requests created in the period, in pieces where the unit converts.",
		"Quantity fulfilment uses the district's acknowledged receipt, not the warehouse's issue."},
	"stock": {"Current stock on the stock date, separate from the reporting period.",
		"Usable excludes reserved, expired and unknown-expiry stock.",
		"Months of stock is issue-based over the last three complete months, and Unavailable without reconciled history."},
	"batches":           {"Bands by calendar months left: expired, under 1 month, under 3 months, under 6 months, ok, unknown."},
	"expiry-exceptions": {"Batches with under one month left that left a store in the period, with the documented reason."},
	"hmis-105": {"Acknowledged receipts at hotspots dated by acknowledgement: operational evidence of supply, not condoms dispensed.",
		"Not submitted: the counting event, dispensing channel and subcounty reporting units await programme approval."},
}

// build calculates a report for a user from its parameters: the summary shown on screen, where the
// report has one, and the exported table. The table's filters pin the resolved period and targets, so
// a version recalculated from them covers the same period.
func (h *Handler) build(ctx context.Context, user *users.User, report string, p params) (any, Table, error) {
	columns, ok := exportColumns[report]
	if !ok {
		return nil, Table{}, errInvalid{errors.New("report must be notifications, warehouse-requests, stock, batches, expiry-exceptions or hmis-105")}
	}
	for key := range p {
		if !filterKeys[key] {
			return nil, Table{}, errInvalid{fmt.Errorf("%s is not a filter of this report", key)}
		}
	}
	t := Table{Report: report, Title: exportTitles[report], RuleVersion: stock.RuleVersion, Columns: columns,
		Definitions: append(append([]string{}, exportDefinitions[report]...), blankRule), Filters: map[string]string{}}
	for key, value := range p {
		t.Filters[key] = value
	}
	var summary, rows any
	var s scope
	var category string
	var district, store, hotSpot *string
	switch report {
	case "notifications":
		f, sc, settings, err := h.filter(ctx, user, p)
		if err != nil {
			return nil, Table{}, errInvalid{err}
		}
		s, category, district, hotSpot = sc, f.Category, f.DistrictID, f.HotSpotID
		f.Status = p.get("status")
		switch f.Status {
		case "", "fulfilled", "partly_received", "awaiting_acknowledgement", "awaiting_supply", "rejected":
		default:
			return nil, Table{}, errInvalid{errors.New("status must be fulfilled, partly_received, awaiting_acknowledgement, awaiting_supply or rejected")}
		}
		sum, err := h.repo.notificationSummary(ctx, s, f, h.now())
		if err != nil {
			return nil, Table{}, err
		}
		sum.Settings = settings
		f.Limit = exportLimit + 1
		if rows, err = h.repo.notificationRecords(ctx, s, f); err != nil {
			return nil, Table{}, err
		}
		summary, t.DataUpdatedAt = sum, sum.DataUpdatedAt
		t.Period = sum.Period.From + " to " + sum.Period.To
		t.Filters["from"], t.Filters["to"] = sum.Period.From, sum.Period.To
		t.Filters["deadline_days"], t.Filters["target_percent"] = strconv.Itoa(f.DeadlineDays), strconv.Itoa(f.Target)
	case "hmis-105":
		month, d, err := h.hmisFilter(p)
		if err != nil {
			return nil, Table{}, errInvalid{err}
		}
		if s, err = h.repo.scopeFor(ctx, user); err != nil {
			return nil, Table{}, err
		}
		district = d
		r, err := h.repo.hmisReadiness(ctx, s, month, d, h.now())
		if err != nil {
			return nil, Table{}, err
		}
		summary, rows, t.DataUpdatedAt, t.Period = r, r.Rows, r.DataUpdatedAt, month.Format("January 2006")
		t.Filters["month"] = r.Month
	default:
		f, sc, err := h.supplyFilter(ctx, user, p)
		if err != nil {
			return nil, Table{}, errInvalid{err}
		}
		s, category, district, store = sc, f.Category, f.DistrictID, f.StoreID
		t.DataUpdatedAt = h.now()
		period := periodOf(f.Filter)
		t.Period = period.From + " to " + period.To
		f.Limit = exportLimit + 1
		switch report {
		case "warehouse-requests":
			sum, err := h.repo.supplyReport(ctx, s, f, h.now())
			if err != nil {
				return nil, Table{}, err
			}
			if rows, err = h.repo.requestRecords(ctx, s, f); err != nil {
				return nil, Table{}, err
			}
			summary, t.DataUpdatedAt = sum, sum.DataUpdatedAt
			t.Filters["from"], t.Filters["to"] = period.From, period.To
		case "expiry-exceptions":
			if rows, err = h.repo.expiryExceptions(ctx, s, f); err != nil {
				return nil, Table{}, err
			}
			t.Filters["from"], t.Filters["to"] = period.From, period.To
		case "stock":
			r, err := h.repo.stockReport(ctx, s, f, h.now())
			if err != nil {
				return nil, Table{}, err
			}
			summary, rows, t.DataUpdatedAt = r, r.Lines, r.StockDate
			t.Period = "Stock on " + r.StockDate.In(Kampala).Format(time.DateOnly)
		case "batches":
			band := p.get("band")
			if !bands[band] {
				return nil, Table{}, errInvalid{errors.New("band must be expired, under_1_month, under_3_months, under_6_months, ok or unknown")}
			}
			r, err := h.repo.batchReport(ctx, s, f, band, h.now())
			if err != nil {
				return nil, Table{}, err
			}
			summary, rows, t.DataUpdatedAt = r, r.Lines, r.StockDate
			t.Period = "Stock on " + r.StockDate.In(Kampala).Format(time.DateOnly)
		}
	}
	var err error
	if t.Rows, err = asRows(rows); err != nil {
		return nil, Table{}, err
	}
	if len(t.Rows) > exportLimit {
		return nil, Table{}, errInvalid{errTooManyRows}
	}
	t.Product = map[string]string{"male": "Male condoms", "female": "Female condoms"}[category]
	if t.Product == "" {
		t.Product = "Male and female condoms"
	}
	if t.Scope, err = h.repo.scopeLabel(ctx, s, district, store, hotSpot); err != nil {
		return nil, Table{}, err
	}
	return summary, t, nil
}

// asRows turns report records into JSON objects keyed by their JSON field names.
func asRows(records any) ([]map[string]any, error) {
	rows := []map[string]any{}
	raw, err := json.Marshal(records)
	if err != nil || string(raw) == "null" {
		return rows, err
	}
	return rows, json.Unmarshal(raw, &rows)
}

// scopeLabel names what the user may see and the filters that narrow it, for export headers.
func (r *Repository) scopeLabel(ctx context.Context, s scope, district, store, hotSpot *string) (string, error) {
	own := s.storeID
	if s.all {
		own = nil
	}
	var label string
	err := r.db.QueryRow(ctx, `SELECT concat_ws(' · ', CASE WHEN $1 THEN 'National' ELSE 'Assigned area' END,
			(SELECT name FROM stores WHERE id = $2::uuid), (SELECT name FROM districts WHERE id = $3::uuid),
			(SELECT name FROM stores WHERE id = $4::uuid), (SELECT name FROM hot_spots WHERE id = $5::uuid))`,
		s.all, own, district, store, hotSpot).Scan(&label)
	return label, err
}

// writeCSV writes the table's header block, a blank line, then the column headers and rows.
func writeCSV(w io.Writer, t Table) error {
	out := csv.NewWriter(w)
	header := [][]string{{"Report", t.Title}, {"Period", t.Period},
		{"Data updated", t.DataUpdatedAt.In(Kampala).Format("2006-01-02 15:04")}, {"Scope", t.Scope},
		{"Product", t.Product}, {"Rule version", t.RuleVersion}}
	for _, d := range t.Definitions {
		header = append(header, []string{"Definition", d})
	}
	header = append(header, []string{})
	for _, record := range header {
		if err := out.Write(safeCells(record)); err != nil {
			return err
		}
	}
	line := make([]string, len(t.Columns))
	for i, c := range t.Columns {
		line[i] = c.Header
	}
	if err := out.Write(line); err != nil {
		return err
	}
	for _, row := range t.Rows {
		for i, c := range t.Columns {
			line[i] = cell(row[c.Key])
		}
		if err := out.Write(safeCells(line)); err != nil {
			return err
		}
	}
	out.Flush()
	return out.Error()
}

// cell formats a value: blank for null, Yes/No, plain numbers, and timestamps as Kampala time.
func cell(v any) string {
	switch v := v.(type) {
	case nil:
		return ""
	case bool:
		if v {
			return "Yes"
		}
		return "No"
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case string:
		if t, err := time.Parse(time.RFC3339Nano, v); err == nil {
			if t.Hour() == 0 && t.Minute() == 0 && t.Second() == 0 && t.Nanosecond() == 0 {
				return t.Format(time.DateOnly) // a date column, such as an expiry date
			}
			return t.In(Kampala).Format("2006-01-02 15:04")
		}
		return v
	}
	return fmt.Sprint(v)
}

// safeCells stops spreadsheet programs reading text such as a hotspot name as a formula.
func safeCells(record []string) []string {
	for i, v := range record {
		if v != "" && strings.ContainsRune("=+-@\t\r", rune(v[0])) {
			if _, err := strconv.ParseFloat(v, 64); err != nil {
				record[i] = "'" + v
			}
		}
	}
	return record
}

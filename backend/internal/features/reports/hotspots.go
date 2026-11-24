package reports

import (
	"context"
	"time"

	"clims-backend/internal/features/users"

	"github.com/jackc/pgx/v5"
)

// HotspotCounts are the hotspots in a group by where they stand in review, with the ones that have a
// condom dispenser and a recorded position.
type HotspotCounts struct {
	Total       int64 `json:"total"`
	Active      int64 `json:"active"`
	Submitted   int64 `json:"submitted"`
	Rejected    int64 `json:"rejected"`
	Deactivated int64 `json:"deactivated"`
	// Dispenser is the hotspots that report a condom dispenser.
	Dispenser int64 `json:"with_dispenser"`
	// Located is the hotspots with a map position.
	Located int64 `json:"located"`
	// OpenRequests is the hotspots waiting on a stockout request (neither fulfilled nor rejected).
	OpenRequests int64 `json:"open_requests"`
}

type HotspotGroup struct {
	ID   *string `json:"id"`
	Name *string `json:"name"`
	HotspotCounts
}

type HotspotMonth struct {
	Month      string `json:"month"` // YYYY-MM, by the day the hotspot was recorded
	Registered int64  `json:"registered"`
	Activated  int64  `json:"activated"` // of those registered, active now
}

type HotspotReport struct {
	DataUpdatedAt time.Time      `json:"data_updated_at"`
	Total         HotspotCounts  `json:"total"`
	ByRegion      []HotspotGroup `json:"by_region"`
	ByDistrict    []HotspotGroup `json:"by_district"`
	// ByType groups the free-text venue type into the guidelines' pick-point types ("Not recorded"
	// when it holds no venue, as the legacy "new" and "old" do).
	ByType []HotspotGroup `json:"by_type"`
	// Dispensers groups the recorded condition of hotspots' dispensers into a few states.
	Dispensers []HotspotGroup `json:"dispensers"`
	// Registrations are the last twelve Kampala months, oldest first.
	Registrations []HotspotMonth `json:"registrations"`
}

// HotspotFilter narrows the hotspot report to a region or district.
type HotspotFilter struct {
	RegionID   *string
	DistrictID *string
}

// venueTypeSQL sorts the free-text venue type into the pick-point types of the Condom Distribution
// Guidelines 2022 (pp. 4-5). Legacy records hold "new" or "old" there, a registration flag rather than
// a venue, and many were cut at eight characters, so the match is on word stems. A mixed venue ("bar
// and lodge") takes its first word.
const venueTypeSQL = `(SELECT CASE
		WHEN t IS NULL OR t IN ('new', 'old', 'type', 'male', 'female c') OR t ~ '^[0-9]+$' THEN NULL
		WHEN t ~ '^(b[aá]r|pub|club|disco|lounge|lounge|pool|casino|hangout|sports b|pork)' THEN 'Bar, pub or club'
		WHEN t ~ '^(lo[du]?g|loudg|louge)' THEN 'Lodge'
		WHEN t ~ '^(gu?e[s]?[s]?t|gesth|guess|accom|hostel)' THEN 'Guest house'
		WHEN t ~ '^(hotel|motel|inn|hot$|beach h)' THEN 'Hotel or motel'
		WHEN t ~ '(boda|stage|taxi|lorry|garage|mechanic|washing)' THEN 'Transport stage'
		WHEN t ~ '(landing|land sit|fish|beach)' THEN 'Landing site'
		WHEN t ~ '(market|kikuubo|trading|shop|kiosk|retail|street|slum|village|local co|hub)' THEN 'Market or trading centre'
		WHEN t ~ '(massage|spa|saloon|salon|parlo|palor|fitness)' THEN 'Massage parlour, spa or salon'
		WHEN t ~ '(restaura|restorat|cafe|garden)' THEN 'Restaurant or garden'
		WHEN t ~ '(video|cinema|film)' THEN 'Video or cinema hall'
		WHEN t ~ '(health|clinic|hospital|facility|medical|drug|^h ?c|^hf|pnfp)' THEN 'Health facility or drug shop'
		WHEN t ~ '(institut|school|universi|campus|work|police|armed|govermen|staff|lc 1)' THEN 'Workplace or institution'
		WHEN t ~ '(prostitu|bar pros)' THEN 'Sex work venue'
		WHEN t ~ '^vht' THEN 'Community (VHT)'
		ELSE 'Other' END
	FROM (SELECT nullif(lower(btrim(h.type)), '') AS t) v)`

// dispenserConditionSQL sorts the free-text dispenser condition into a few states.
const dispenserConditionSQL = `(SELECT CASE
		WHEN t IS NULL OR t IN ('dispenser_condition', 'no', 'yes', 'bar', 'nane') OR length(t) < 3 THEN NULL
		WHEN t ~ '(not installed|not pinned)' THEN 'Not installed'
		WHEN t ~ '(empty)' THEN 'Empty'
		WHEN t ~ '(need|not enough|only one|more)' THEN 'Too few dispensers'
		WHEN t ~ '(poor|bad|abad|broken|damag|falling|not in|lid|prone|rain)' THEN 'Needs repair'
		WHEN t ~ '(good|goid|functional|fiunctional|ok|work|excellent|intact|fair|fine|okay)' THEN 'Working'
		ELSE NULL END
	FROM (SELECT nullif(lower(btrim(h.dispenser_condition)), '') AS t) v)`

// hotspotsCTE is every hotspot the user may report on that matches the filter: all of them for
// national users (orders:all_stores or hotspots:all_districts), else those of the district they work
// in. $1 all, $2 the user's district, $3 region filter, $4 district filter.
const hotspotsCTE = `WITH hs AS (
	SELECT h.id, h.name, h.status, h.review_status, h.district_id, d.name AS district, d.region_id,
		rg.name AS region, ` + venueTypeSQL + ` AS venue_type,
		coalesce(h.has_condom_dispenser, false) AS dispenser,
		` + dispenserConditionSQL + ` AS dispenser_condition,
		h.latitude IS NOT NULL AND h.longitude IS NOT NULL AS located, h.created_at,
		EXISTS (SELECT 1 FROM stockout_reports r WHERE r.hot_spot_id = h.id
			AND r.fulfilled_at IS NULL AND r.rejected_at IS NULL) AS open_request
	FROM hot_spots h
	LEFT JOIN districts d ON d.id = h.district_id
	LEFT JOIN regions rg ON rg.id = d.region_id
	WHERE ($1::boolean OR h.district_id = $2::uuid)
		AND ($3::uuid IS NULL OR d.region_id = $3) AND ($4::uuid IS NULL OR h.district_id = $4))`

const hotspotCountsSQL = `count(*), count(*) FILTER (WHERE review_status = 'active'),
	count(*) FILTER (WHERE review_status = 'submitted'), count(*) FILTER (WHERE review_status = 'rejected'),
	count(*) FILTER (WHERE review_status = 'deactivated'), count(*) FILTER (WHERE dispenser),
	count(*) FILTER (WHERE located), count(*) FILTER (WHERE open_request)`

func scanHotspotGroup(row pgx.CollectableRow) (HotspotGroup, error) {
	var g HotspotGroup
	err := row.Scan(&g.ID, &g.Name, &g.Total, &g.Active, &g.Submitted, &g.Rejected, &g.Deactivated,
		&g.Dispenser, &g.Located, &g.OpenRequests)
	return g, err
}

// userDistrict is the district a user works in (users.DistrictOfUser), or nil.
func (r *Repository) userDistrict(ctx context.Context, userID string) (*string, error) {
	var id *string
	err := r.db.QueryRow(ctx, `SELECT `+users.DistrictOfUser, userID).Scan(&id)
	return id, err
}

// hotspotReport counts every hotspot when all is set, else those of district (nil sees none).
func (r *Repository) hotspotReport(ctx context.Context, all bool, district *string, f HotspotFilter, now time.Time) (HotspotReport, error) {
	args := []any{all, district, f.RegionID, f.DistrictID}
	out := HotspotReport{DataUpdatedAt: now}
	t := &out.Total
	if err := r.db.QueryRow(ctx, hotspotsCTE+` SELECT `+hotspotCountsSQL+` FROM hs`, args...).Scan(
		&t.Total, &t.Active, &t.Submitted, &t.Rejected, &t.Deactivated, &t.Dispenser, &t.Located, &t.OpenRequests); err != nil {
		return HotspotReport{}, err
	}
	groups := func(sql string) ([]HotspotGroup, error) {
		rows, err := r.db.Query(ctx, hotspotsCTE+sql, args...)
		if err != nil {
			return nil, err
		}
		return pgx.CollectRows(rows, scanHotspotGroup)
	}
	var err error
	if out.ByRegion, err = groups(` SELECT region_id::text, region, ` + hotspotCountsSQL + ` FROM hs
		GROUP BY 1, 2 ORDER BY count(*) DESC, 2 NULLS LAST`); err != nil {
		return HotspotReport{}, err
	}
	if out.ByDistrict, err = groups(` SELECT district_id::text, district, ` + hotspotCountsSQL + ` FROM hs
		GROUP BY 1, 2 ORDER BY count(*) DESC, 2 NULLS LAST`); err != nil {
		return HotspotReport{}, err
	}
	if out.ByType, err = groups(` SELECT NULL::text, coalesce(venue_type, 'Not recorded'), ` + hotspotCountsSQL + `
		FROM hs GROUP BY 2 ORDER BY count(*) DESC, 2`); err != nil {
		return HotspotReport{}, err
	}
	if out.Dispensers, err = groups(` SELECT NULL::text, coalesce(dispenser_condition, 'Not recorded'), ` +
		hotspotCountsSQL + ` FROM hs WHERE dispenser GROUP BY 2 ORDER BY count(*) DESC, 2`); err != nil {
		return HotspotReport{}, err
	}

	// The last twelve months; hot_spots.created_at holds UTC without a time zone.
	local := now.In(Kampala)
	first := time.Date(local.Year(), local.Month(), 1, 0, 0, 0, 0, Kampala).AddDate(0, -11, 0)
	rows, err := r.db.Query(ctx, hotspotsCTE+`
		SELECT to_char(created_at + interval '3 hours', 'YYYY-MM'), count(*), count(*) FILTER (WHERE review_status = 'active')
		FROM hs WHERE created_at >= $5 GROUP BY 1`, append(args, first.UTC())...)
	if err != nil {
		return HotspotReport{}, err
	}
	byMonth := map[string]HotspotMonth{}
	for rows.Next() {
		var m HotspotMonth
		if err := rows.Scan(&m.Month, &m.Registered, &m.Activated); err != nil {
			rows.Close()
			return HotspotReport{}, err
		}
		byMonth[m.Month] = m
	}
	if err := rows.Err(); err != nil {
		return HotspotReport{}, err
	}
	for month := first; len(out.Registrations) < 12; month = month.AddDate(0, 1, 0) {
		key := month.Format("2006-01")
		m := byMonth[key]
		m.Month = key
		out.Registrations = append(out.Registrations, m)
	}
	return out, nil
}

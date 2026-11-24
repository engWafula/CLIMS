# Reports

[Module architecture](README.md)

The reports module serves the programme reports described in the reporting requirements (draft v0.2). Every figure is calculated on request from source records, using the same notification facts as the orders screens, so a total and the records behind it always agree (RN02).

| Method | Route                                        | Permission          |
| ------ | -------------------------------------------- | ------------------- |
| GET    | `/api/v1/reports/notifications`              | `reports:read`      |
| GET    | `/api/v1/reports/notifications/records`      | `reports:read`      |
| GET    | `/api/v1/reports/warehouse-requests`         | `reports:read`      |
| GET    | `/api/v1/reports/warehouse-requests/records` | `reports:read`      |
| GET    | `/api/v1/reports/stock`                      | `reports:read`      |
| GET    | `/api/v1/reports/batches`                    | `reports:read`      |
| GET    | `/api/v1/reports/expiry-exceptions`          | `reports:read`      |
| GET    | `/api/v1/reports/settings`                   | `reports:read`      |
| POST   | `/api/v1/reports/settings`                   | `reports:configure` |
| GET    | `/api/v1/reports/hmis-105`                   | `reports:read`      |
| GET    | `/api/v1/reports/trends`                     | `reports:read`      |
| GET    | `/api/v1/reports/hotspots`                   | `reports:read`      |
| GET    | `/api/v1/reports/export/{report}`            | `reports:read`      |
| GET    | `/api/v1/reports/versions`                   | `reports:read`      |
| POST   | `/api/v1/reports/versions`                   | `reports:approve`   |
| GET    | `/api/v1/reports/versions/{id}`              | `reports:read`      |
| POST   | `/api/v1/reports/versions/{id}/corrections`  | `reports:approve`   |

## Notification fulfilment

A hotspot stockout notification names Male, Female or Both and no quantity. The district delivers against it and the hotspot's manager acknowledges the pieces received; see [orders](orders.md#1a-the-district-delivers-and-the-hotspot-manager-acknowledges). Each notification has one status:

| Status                     | Meaning                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| `awaiting_supply`          | Nothing delivered yet                                               |
| `awaiting_acknowledgement` | Delivered, but no positive acknowledgement yet                      |
| `partly_received`          | Some selected types acknowledged, not all                           |
| `fulfilled`                | The manager acknowledged a positive receipt for every selected type |

`GET /api/v1/reports/notifications` reports on notifications **raised in the period**:

- **Notifications raised**, counted once each; repeated messages against an open notification are not counted again. `by_selection` splits them by Male, Female and Both.
- **Notifications fulfilled**: raised in the period and fully acknowledged by `data_updated_at`. Dispatch or delivery entry alone does not count. `acknowledgements_through` states the time up to which acknowledgements are included.
- **Fulfilment rate**: fulfilled divided by raised, as a percentage to one decimal. With no notifications it is `null` (Not applicable).
- **Component**: with `category=male` or `female`, the report covers notifications that include that type, and `component` gives that type's part. A Both notification counts under each type, so the two components exceed the unique total.
- **Response**: the median hours from notification to the last acknowledgement needed, among fulfilled notifications, with the pending count and the oldest pending age. The clock starts when the notification was first raised; a repeat does not restart it.
- **Deadline**: notifications fulfilled within the deadline divided by those raised, against the on-time target (see [response settings](#response-settings)), and open notifications already past the deadline. For a period still in progress this is progress to date.
- **Backlog**: open notifications raised before the period, kept apart from it.
- **Acknowledgement overdue**: a quality issue, counting notifications with a delivery left unacknowledged for longer than the deadline.
- **Districts**: raised, fulfilled and rate per district, for comparison.

`GET /api/v1/reports/notifications/records` lists the notifications behind those totals for the same filters, newest first, with the pieces delivered and acknowledged per type, the response time and the overdue flag. Filter by `status` and page with `limit` and `offset`. `GET /api/v1/orders/stockouts/{id}` opens one notification's deliveries, acknowledgements and history.

## Warehouse requests

`GET /api/v1/reports/warehouse-requests` reports on district requests to the national warehouses raised in the period, in total and `by_type` (male, female), `by_warehouse` and `by_district`:

- **Requested, approved, issued and acknowledged pieces.** Requested is the original request. Approved is what the warehouse approved at review, which may be less ([orders](orders.md)). Issued is what it dispatched, and acknowledged is what the district counted on receipt.
- **Quantity fulfilment rate**: acknowledged pieces divided by originally requested pieces, as a percentage to one decimal.
- **Fully received, partly received, pending and rejected**: a request is fully received when the district counted at least the quantity requested. Pending requests are still open. A request the warehouse rejected is counted as rejected, not pending; it stays in the requested pieces and the fulfilment rate, with nothing approved.
- **Response**: median hours from the request to the district's receipt, with the pending count and the oldest pending age. Rejected requests are not pending.
- **Unconverted**: a quality issue. Quantities convert to pieces with the product's `pieces_per_unit` in its catalogue unit; requests in another unit, or for a product without pieces per unit, are left out of the piece totals and counted here.
- **Awaiting unit**: a district may order a category and a number without a product; the warehouse picks the product, and with it the unit, at review. Until then the request is counted in `awaiting_unit` and left out of the piece totals. It is not a quality issue, so it is no longer counted as unconverted.
- **Dispatches without a request** (`dispatches_without_request`): stock a warehouse sent to a district nobody asked for (district dispatches, [orders](orders.md)), in pieces issued and received and the number still in transit. It is reported apart and is not part of the request totals or the fulfilment rate.

`GET /api/v1/reports/warehouse-requests/records` lists the requests behind those totals, newest first, in units and pieces. Filter both by `warehouse_store_id`, `district_id` and `category`.

## Store stock

`GET /api/v1/reports/stock` is a current, dated view of stock at warehouses and district stores, separate from any reporting period (`stock_date`). Each line is a store, product and unit:

- **Physical, reserved, expired, unknown expiry, usable and in transit.** Usable is physical less expired, unknown-expiry and reserved stock, at least zero; unknown-expiry stock needs its batch reviewed before it counts. In transit is stock dispatched to the store and not yet received, counted once. Pieces are given when the stock is held in the product's catalogue unit.
- **Batches reconciled**: whether the store's batches add up to the physical balance.
- **Reconciled**: whether the inventory ledger adds up to the physical balance.
- **Months of stock**: usable stock divided by average monthly outward issues over the last three complete Kampala months. Outward issues are warehouse dispatches to districts and district deliveries to hotspots. This is issue-based coverage, not consumption. `coverage_status` explains when it is unavailable: the ledger does not reconcile, the history does not cover the whole window, or nothing was issued.

Filter by `store_id`, `store_type`, `district_id` and `category`.

## Batches and expiry

Stock is held in batches, each with an optional batch number and expiry date; see [inventory](inventory.md#batches-and-expiry). `GET /api/v1/reports/batches` lists the batches in stock, earliest expiry first, with `days_remaining` and a `band` by calendar months left: `expired`, `under_1_month` (red), `under_3_months`, `under_6_months`, `ok`, or `unknown` without an expiry date. Filter by store, store type, district, category and `band`.

`GET /api/v1/reports/expiry-exceptions` lists the batches with under one month left that left a store in the period, with the documented reason, who authorised it and the rule version, newest first.

The draft's six-month warehouse and three-month district dispatch targets are not enforced: each shipped batch's `days_remaining` on the dispatch date is recorded, so they can be reported once approved.

## Trends

`GET /api/v1/reports/trends` gives each measure per `day`, `week` (from Monday) or `month` (from the 1st), in Kampala time, over the period (default: the last six calendar months to date; the interval defaults to days up to a month, weeks up to about a quarter, months beyond, and a period may hold at most 400 buckets). Each bucket has:

- **notifications**: raised in the bucket, and of those the fulfilled, rejected, fulfilment rate and median hours to fulfil. Notifications are followed as a cohort by the day they were raised, as the notification report counts them, so a trend adds up to the report total for its period.
- **requests**: district requests to national warehouses placed in the bucket, with requested, approved, issued and acknowledged pieces, as the warehouse request report counts them.
- **deliveries**: district deliveries to hotspots recorded in the bucket, male and female pieces, and what hotspot managers have acknowledged of them.
- **stock**: movements at the stores the user may see, in pieces: received from suppliers (receipts and opening balances), dispatched by warehouses, received by district stores, delivered to hotspots and net adjustments. Quantities in another unit than the product's catalogue unit are left out.

It takes the warehouse request filters (`district_id`, `warehouse_store_id`, `store_id`, `store_type`, `category`) and `hot_spot_id`, with the same access rules as each report.

## Hotspot coverage

`GET /api/v1/reports/hotspots` counts hotspots by review status, with a dispenser, with a map position and waiting on an open stockout request, in total and by region and district; by venue type, sorted from the free-text type into the pick-point types of the Condom Distribution Guidelines 2022 (legacy records holding "new" or "old" are "Not recorded"); by dispenser condition (Working, Needs repair, Empty, Too few dispensers, Not installed, Not recorded); and the hotspots recorded in each of the last twelve months, by the day the record was created (records imported from the legacy system carry their import date). National users (`orders:all_stores` or `hotspots:all_districts`) see every hotspot, others the district they work in; an account with no district is refused (403). `region_id` and `district_id` narrow it.

## Response settings

The review cycle (`weekly`, `monthly`, `bimonthly` or `quarterly`), the receipt deadline in days and the on-time target percentage are saved settings (RF07). `POST /api/v1/reports/settings` adds a row for one store, or nationally without `store_id`, applying from `effective_from` (today or later) and recording who set it and why. Rows are never changed, so an earlier report can be reproduced with the settings it used.

The settings in effect are the store's own latest row, else the national one, else the draft defaults (monthly, 7 days, 80%), and `source` says which. The notification report uses the settings of the filtered district's store, else the user's store, and returns them in `settings`; without `from` and `to` its period is the current review cycle to date. `deadline_days` and `target_percent` parameters still override them for ad hoc analysis. `GET /api/v1/reports/settings` shows the settings in effect for a store or nationally, with their history.

A user sets targets for their assigned store only (RN11); national settings and other stores need `orders:all_stores`.

## HMIS 105 readiness

`GET /api/v1/reports/hmis-105?month=YYYY-MM` prepares 105-CT11 Female and 105-CT12 Male condoms in pieces from hotspot managers' acknowledged receipts, dated by the acknowledgement in Kampala time and grouped by the hotspot's district and subcounty (RF14). Lines delivered in the month but not yet acknowledged are shown as a quality issue and not counted. These figures are evidence of supply, not condoms dispensed: the response lists the decisions still pending (the counting event, the dispensing channel and the subcounty reporting units), and `integration_enabled` stays `false`, so nothing is sent to DHIS2. National users see every district, others the district they work in.

## Exports

`GET /api/v1/reports/export/{report}` returns a report's rows exactly as the screen shows them (RF15, RN02): `notifications`, `warehouse-requests`, `stock`, `batches`, `expiry-exceptions` or `hmis-105`, with that report's own query parameters and access rules. Each export carries the period, data update time, scope, product, rule version and the definitions that apply, and the server defines the columns and their headers. `format=csv` downloads a CSV that starts with that information, then the headers and rows, with times in Kampala. Text that a spreadsheet could run as a formula is prefixed with an apostrophe. Without `format`, the JSON table is what the web screens show and turn into Excel. A blank cell means not applicable or not recorded, while 0 is a recorded zero. An export holds at most 50,000 rows; beyond that it asks for narrower filters.

## Approved versions

`POST /api/v1/reports/versions` approves a report as calculated now for its filters, saving the figures and rows unchanged with who approved them and an optional note (RF15, RN04). The saved filters pin the period, and for notifications the deadline and target, so a recalculation covers the same period. Stock and batches are current views, so a recalculation reads current stock.

A correction (`POST /api/v1/reports/versions/{id}/corrections`, with a reason) recalculates from the saved filters and saves a new version that supersedes the old one. The old version keeps its figures, so it can still be reproduced. Only the latest version can be corrected, and a second correction of the same version is refused (409).

National users (`orders:all_stores`) approve national versions and see every version. Others approve for their assigned store and see only its versions, and only a user with the same scope can correct a version. `GET /api/v1/reports/versions/{id}?format=csv` downloads a version's saved rows.

## Screens

The web app's **Reports and analytics** page (`/moh/programme-reports`, `/dcfp/programme-reports` and `/warehouse/programme-reports`, "Analytics" in the sidebar) needs `reports:read`. Each report has its own tab: Overview, Stockout requests, Warehouse orders, Stock & coverage, Expiry risk, Expiry exceptions, Hotspot coverage and HMIS 105 (the warehouse workspace shows its own store's), then Approved versions. A tab shows the report's headline figures and charts (in the manner of Power BI: every chart can switch to a table, open in focus mode and download its data as CSV or itself as a picture), then the export table. Filters (period presets or dates, interval, region, district, warehouse, store type, condom type, status, expiry band, month) sit in one bar above everything they scope, live in the address, and show as removable chips; district accounts are limited to their district by the server, so they are not offered a district filter. Downloads: a PDF of the page (headline figures, charts in the light theme, the records, definitions and the filters it covers), the server's CSV, and Excel. Holders of `reports:approve` approve and correct versions. A failed load is shown as an error, never as zeros.

The MOH dashboard is built from the same reports (with a "Needs watching" list of overdue requests, unacknowledged deliveries, expiring and short stock and ledgers out of balance), and the DCFP and warehouse dashboards add a performance section with the same filters and PDF.

Guideline thresholds shown on the charts come from the Condom Distribution Guidelines 2022: keep 2 to 3 months of stock, below 2 months is low stock (pp. 13, 19), and NMS notifies MOH six months before stock expires (p. 8). They are labels for the reader; nothing is enforced.

## Filters and dates

The notification and warehouse request reports accept `from` and `to` as calendar days in Africa/Kampala (`YYYY-MM-DD`, both included), defaulting to the current review cycle to date for notifications and the current month to date for warehouse requests, and `district_id`, `hot_spot_id`, `category`, `deadline_days` and `target_percent`. Timestamps are stored with their time zone and periods are cut at Kampala midnight (RN09).

## Access

Access is checked on the server for every request (RN01). `orders:all_stores` sees every notification, request and store, for national users. Warehouse request and stock reports show other users their assigned store only. For notifications, others see the notifications of their assigned district store, of their assigned hotspot, the ones they sent, and with `orders:stockout_district` the district they work in. Filters only narrow what the user can already see, so another district's data is never returned, including by asking for its hotspot.

Migration 24 grants `reports:read`, migration 27 `reports:configure` and migration 28 `reports:approve` to `admin`; migration 38 grants `reports:read` to the DCFP role. Migration 39 makes `moh` the national, read-only overseer: it grants every read permission (`audit:read`, `hotspots:read`, `hotspots:read_district`, `hotspots:all_districts`, `inventory:read`, `orders:read`, `orders:all_stores`, `reports:read`, `roles:read`, `users:read`) and removes its one write permission, `catalogue:manage`; and it grants `reports:read` to `nms` and `jms`, which see their own store's reports. These are defaults an administrator can still change through `PUT /api/v1/roles/{id}/permissions`; the web app opens every workspace read-only for the `moh` role.

## Not covered yet

These parts of the requirements need decisions or data that do not exist yet:

- **Expiry targets and quarantine (RF16):** the six and three month dispatch targets, the calendar-month boundary rules and who may authorise exceptions await programme approval; quarantined stock is not recorded.
- **Coverage settings (RF11):** the three-month window is the draft's proposal and awaits the supply-chain team's approval.
- **HMIS 105 submission (RF14):** figures are prepared, but the counting event, dispensing channel and reporting units await programme approval, so DHIS2 integration stays disabled.

# Changelog

Notable changes to CLIMS. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Reports and analytics for every user.** The programme reports page becomes a report section in the
  manner of Power BI and Superset: an overview, stockout requests, warehouse orders, stock and coverage,
  expiry risk, expiry exceptions, hotspot coverage and HMIS 105, each with headline figures, charts
  (columns, ranked bars, funnel, gauge, segmented bars, data bars) and the export table. Every chart
  switches to a table, opens in focus mode and downloads as CSV or PNG. Filters (period presets,
  interval, region, district, warehouse, store type, condom type, status, expiry band) live in the
  address with removable chips and an "All filters" pane. Every dashboard and report downloads as a
  PDF with the ministry's seal, the filters it covers, the figures, the charts, the records and the
  definitions. New endpoints: `GET /api/v1/reports/trends` (measures per day, week or month) and
  `GET /api/v1/reports/hotspots` (hotspot coverage).
- **The MOH dashboard reads real data.** It is built from the reports API (it used `/national/*`
  endpoints that never existed and showed sample data), with a "Needs watching" list. The DCFP and
  warehouse dashboards add a performance section with the same filters and PDF, and the warehouse's
  sample charts are replaced by its real dispatches and orders.
- **MOH oversees, read-only.** Migration 39 gives the `moh` role every read permission and no write
  permission (it held only `catalogue:manage`, so MOH accounts could open almost nothing), and NMS and
  JMS `reports:read`. The web app opens every workspace read-only for MOH, whose Orders tabs now show
  every district's real hotspot requests and district orders.

### Fixed

- **Warehouse request report:** a request naming only a category, waiting for the warehouse to pick the
  product, is `awaiting_unit` rather than counted as an unconvertible quality issue; stock sent to a
  district without a request is reported apart (`dispatches_without_request`); types are named Male and
  Female.

- **Delivery agents for hotspot deliveries.** A DCFP may name the delivery agent who carries a
  delivery to a hotspot (`rider_id` on `POST /api/v1/orders/stockouts/{id}/deliveries`); only active
  users with `orders:deliver` working in the hotspot's district qualify, listed by
  `GET /api/v1/orders/stockouts/{id}/riders`. The agent is notified (`order.delivery_assigned`) and
  lists their deliveries with `GET /api/v1/orders/deliveries`. Migration 35 adds
  `hotspot_deliveries.rider_id`. Web: an optional delivery agent in the dispatch dialog. Mobile: a
  signed-in delivery agent's Deliveries and History tabs show the deliveries named for them. The agent may
  also acknowledge what arrived for those deliveries when the hotspot's manager cannot; the district is
  told the agent confirmed.
- **Consistent data table filtering across the web app.** Shared column filters cover text,
  multi-select categories, numeric and date ranges, and empty values, with removable chips,
  clear-all, visible page size and honest warnings when refreshing existing rows fails.
  Shared buttons and form controls have consistent spacing and focus states. ESLint enforces
  component reuse; `practices.md` now describes CLIMS rather than another project's stack.
- **Stricter stock receipt inputs.** Impossible calendar dates and quantities above the API limit
  are rejected before submission. Shared form dialogs focus invalid fields.

- **NMS and JMS send stock to a district before it orders.** `POST /api/v1/orders/district-dispatches`
  (`orders:process`) takes the sending warehouse, a district store and up to 20 lines (product and
  quantity, in the product's catalogue unit), with an optional note and transport. Each line becomes an
  order created `dispatched` with `unrequested: true`, taking free stock (on hand less reserved and
  expired) first expiry first out; the lines go together or not at all, and a refusal names the line.
  The district is told the stock comes without an order and receives it as usual. The warehouse request
  report and the store summary's order counts leave such orders out. Migration 34 adds
  `orders.unrequested`. Web: **Dispatch to district** on the warehouse stock page, and on each
  product's row, opens a panel to choose the district and the products; the DCFP's order page says the
  stock was sent without an order.
- **The warehouse stock page at a glance.** `GET /api/v1/inventory/store-summary?store_id=&from=&to=`
  reports one store: per product and unit, what is on hand, reserved, expired, expiring within three
  months, usable and next to expire, what was received, dispatched and written off in the period, and
  what went out in the last 90 days; and how many district orders wait at each step, with those
  dispatched, rejected, dispatched in full and received short in the period, the districts supplied and
  the median days to dispatch. Web: the warehouse stock page leads with on hand, dispatched, expired,
  expiring, pending district orders and the success rate (dispatched of those dispatched or rejected),
  for the last 30 or 90 days or 12 months, each linking to the list behind it; then products (with
  stock cover in months), batches and movements as three views of one section.
- **Stock is registered in one save.** `POST /api/v1/inventory/receipts` records every batch being
  registered, each with a batch number and a future expiry date, in one transaction; a refusal names
  the line. Web: **Register stock** opens a panel on the stock page where the batches are entered one
  under the other (the product carries over to the next) and registered together.
  `/warehouse/stock/receive` redirects to it.
- **One table everywhere, built for volume.** Every table in the web app is now the shared
  `DataTable`, with the same search, sorting, paging, View menu (columns, row height, rows per page,
  remembered per table) and states as Users & access. `ItemsTable` is gone: line items inside a
  card (a dispatch's batches, a report's figures, a chart's table view) use its `embedded` variant.
  The audit log and the district store's batches moved onto it too. New in the table: rows that open
  onto their detail, footer totals over every matching row, "Select all N" once a page is ticked,
  a header that stays in view on 50- and 100-row pages, search that stays instant over tens of
  thousands of rows, and "Load more" for lists the API pages.
- **The warehouse stock page at any size.** A shelf-life overview shows every batch held as one
  bar per unit of measure, split into the six shelf-life bands, with a legend that opens the batches
  in each band. "Needs attention" lists what to do (expired batches to write off, batches leaving
  within a month, stock without an expiry date, products under a month of stock), at most four
  lines however many batches there are. A product row opens onto its own batches, first expiry
  first, and shows its free stock with a meter of what is reserved and expired; product and batch
  lists total on hand per unit. The movements view pages through the whole ledger, 100 at a time
  (it showed only the newest 100 before), and filters by kind on the server
  (`GET /inventory/movements?reason=&offset=`). A headline amount in several units shows the
  largest as the figure and the rest beneath. Mock: `MOCK_DATA=scale` adds a national store's
  volume at NMS (about 250 products, a thousand batches, two thousand movements).
- **Batches can be edited and deleted.** `PATCH /api/v1/inventory/batches/{id}` corrects a batch's
  number, expiry date and quantity with a note; a number already held under the same expiry joins the
  two. `DELETE /api/v1/inventory/batches/{id}` erases a batch nothing has left yet (`untouched` in the
  batch list) as if it was never registered; once stock has left a batch it is refused (409). Both are
  audited and stop at what open orders have reserved. Web: each batch's menu on the stock page has
  **Edit batch…** and **Delete batch…**; deleting a batch stock has left writes off what is left, with
  the reason, and keeps its history.
- Warehouse wording: a new district order's action reads **Manage order** (was "Decide on order"),
  on the requests list, the order page and the dashboard's tasks.

### Changed

- **NMS and JMS switch the warehouse dashboard and district orders to any district**, as MOH can.
  The District menu lists every district instead of only those that have ordered from the store, so
  a district with no order yet can be picked. A district with no orders says so, and the sidebar
  counts still cover the whole store.
- **The DCFP orders from the warehouse without choosing a unit.** `POST /api/v1/orders/warehouse-requests`
  takes `warehouse_store_id`, `condom_category`, `quantity` and an optional `comment`; a body with
  `unit_of_measure_id` is refused (400). The order's `unit_of_measure_id` stays null until the
  warehouse chooses the product at `review`, which gives the order that product's catalogue unit (422
  on `error.condom_id` when the product has none). Migration 33 lets an order lack a unit until it has
  a product. Web: the new warehouse order form no longer asks for a unit, and the warehouse's approval
  reads each product's stock in its own unit.
- **Stockouts notify the DCFP; the DCFP orders from NMS or JMS.** `POST /api/v1/orders/stockouts` now
  records a stockout report and notifies the hotspot's district DCFPs (`orders:replenish`) with the
  hotspot's details, its contact and the message. It creates no order and returns a `StockoutReport`.
  `GET /api/v1/orders/stockouts` lists reports.
- The DCFP places an order with a national warehouse through the new
  `POST /api/v1/orders/warehouse-requests` (warehouse, product, quantity; unit defaults to the
  product's). The warehouse reviews, checks stock and dispatches, and the district receives.

- **Web DCFP workspace on the Go API.** New **Stockouts** screen lists each hotspot's report with
  its place, contact, message and reporter, and starts a warehouse order for the product.
  **Restock** lists the DCFP's orders to NMS and JMS, places a new one (warehouse, product,
  quantity) and records the receipt, with a note when the count differs. The dashboard and sidebar
  badges follow the two flows.
- The top bar's bell reads the central inbox (`/api/v1/notifications`), counts unread items, opens
  DCFP notifications on their screen and marks them read.

### Removed

- **Web access for field roles.** VHTs, hotspot managers and delivery agents use only the mobile app.
  Web sign-in, by password or from the portal, refuses an account whose roles open no web workspace
  and work in the field app: it ends the session the API just opened and points the person to the
  mobile app. A session kept from before opens no page either. The VHT web workspace (`/vht`, My
  hotspots) and the web's Submit hotspot form are gone; VHTs submit hotspots in the mobile app, and
  the API is unchanged.

- The warehouse screens' mock-only `/warehouses/{code}/…` contract and its sample requests, stock and
  dispatch picker; the warehouse now reads orders, stock and batches from the Go API.

- **Generic store-to-store orders and the orders-only inbox.** `POST /api/v1/orders`,
  `PATCH /api/v1/orders/{id}/fulfill` and `GET /api/v1/orders/notifications` had no client: the web
  and mobile apps use warehouse orders and the central inbox. Migration 32 deletes `orders:create`,
  `orders:fulfill` and the unused `orders:deliver` with their grants, and the inbox's routing
  columns on `order_events`. Orders already recorded that way stay readable.

- The web DCFP screens for hotspot orders: the order queue, held orders, order review and rider
  dispatch (`/dcfp/orders…`, `/dcfp/dispatch…`).
- The hotspot alert actions `request-replenishment`, `deliver` and the DCFP's rider `dispatch`, with
  the `order.delivery_assigned` and `order.delivered` notifications. Earlier alert orders stay as
  read-only history (migration 22).

### Fixed

- Two migrations shared version 20, so the API failed at start-up ("duplicate migration file").
  `vht_district_stockouts` is now migration 21.
- The audit log and condom category requests both added migration 29, and the API no longer
  compiled: the audit entries still expected every order and stockout report to name a product.
  `order_condom_category` is now migration 30, and a category request is recorded without a
  product until the warehouse chooses one.

### Added

- **Documentation site at `/handbook/`.** `docs/` is published as a Docusaurus site, with search,
  served from the production server by a new `docs` release image (`DOCS_IMAGE` in `images.env`).
  It updates with each stable release. In development it is at `http://localhost:8080/handbook/`
  with live reload, or run `make docs-serve`. See
  [ADR 0004](adr/0004-documentation-site.md).
- **Warehouse stock on the Go API.** The stock page shows, per product, what is free to reserve,
  what is reserved, expired and expiring within 3 months, and the next expiry; every batch with its
  shelf-life band (filtered by band from the address); and the stock ledger with each entry's batch.
  A batch can be adjusted after a count or written off as damaged, expired or lost, with a note.
  **Record a delivery** (`/warehouse/stock/receive`) records a delivery batch by batch, with its
  number, expiry date and quantity. The dashboard lists orders to decide, reserve, dispatch or
  recheck and batches to write off or send first, on live data; batch expiry alerts in the bell open
  the stock page.
- Inventory movements name the batch a receipt or adjustment changed (`batch_number`,
  `expiry_date`).

- **Warehouse district requests on the Go API.** NMS and JMS list the orders districts placed with
  them and open one to decide: choose the product to send from the category requested (each with
  what it can reserve), approve all or part, and the stock is reserved at once or the order waits
  for stock; a held order is checked again or approved again for less or another product. A
  reserved order is dispatched first expiry first out: the page shows the batches that will go,
  asks for a reason when one has under a month left, and records the transport. Any order can be
  rejected with a reason before dispatch. The sidebar badge counts orders to decide or dispatch,
  and the bell opens warehouse order notifications on these screens.
- `GET /api/v1/inventory/batches` lists a store's batches with their shelf-life band and days left,
  for `inventory:read`, in the order dispatch takes them.

- **Batch expiry alerts.** Every hour the server tells the people who manage a store's stock
  (`inventory:manage` at the store), at NMS, JMS and district stores alike, once when a batch with
  stock comes within 3 months of its expiry date (`inventory.batch_expiring`) and once when it
  expires (`inventory.batch_expired`).

- **NMS and JMS can reject a district's order.** `POST /api/v1/orders/{id}/actions/reject` with a
  required `reason`, at any step before dispatch. The order becomes `rejected`, keeps
  `rejection_reason` and releases anything `check-stock` reserved (migration 31).
- **The DCFP hears what the warehouse decided.** Review sends `order.replenishment_approved` with the
  product chosen and the approved quantity (saying when it is less than ordered); rejection sends
  `order.replenishment_rejected` quoting the reason. A receipt now also notifies the warehouse, with
  any discrepancy note.
- Dispatch can record the transport (waybill, vehicle, driver and phone, each optional), which the
  district's dispatch notification includes.
- Migration 31 grants the `nms` and `jms` roles `orders:read`, `orders:process`, `inventory:read` and
  `inventory:manage`, and the `dfcp` role `orders:read`, `orders:replenish`, `orders:receive`,
  `inventory:read` and `inventory:manage`, by default. Administrators can change them in Users &
  access.
- The warehouse requests report counts `rejected` requests, which are no longer counted as pending
  or approved.
- **Web Restock shows the warehouse's decision.** A rejected order says why, with a link to place a
  new one; an approval of less than ordered says so; a dispatched order shows its waybill, vehicle and
  driver. The bell opens approval and rejection notifications on the order. Reviewed orders read
  "Approved".

- **VHT stockout alerts for their district.** A VHT with the new `orders:stockout_district` permission can
  raise a stockout alert for any active hotspot in the district they work in (assigned store's district,
  or else assigned subcounty's). Inactive hotspots and other districts are refused.
- `hotspots:read_district` lets a VHT list and view their district's active hotspots, to choose one; it
  does not open those hotspots' comment threads.
- Migration 21 adds the two permissions (granted to admin). Grant VHTs `hotspots:read`, `hotspots:submit`,
  `hotspots:read_district`, `orders:stockout` and `orders:stockout_district` through the RBAC API.
- **Web app** in `frontend/`, imported from the `LMD_FE` prototype and rebuilt on Next.js 16,
  React 19, TypeScript, Tailwind CSS 4 and shadcn/ui, themed after the SalesOps dashboard reference in light
  mode with an optional dark theme. Decisions are recorded in `docs/adr/0001-frontend-stack.md`.
- Sign-in, sign-out and a route guard. Signing out or an expired session in one browser tab signs
  out the others.
- User management, condom items, condom stock and hotspots: searchable, sortable, paginated tables
  with create, edit and delete, Excel export, and loading, empty and error states.
- A hotspot map that plots the hotspots recorded in the system.
- Stock adjustments must state whether they add or distribute stock; neither is preselected.
- A mock API for developing the UI without a backend, with demo, worst-case and empty datasets
  (`npm run mock-api`).
- Unit and behaviour tests, with coverage enforced at 80% on domain code.
- ESLint (type-aware, strict, accessibility rules) and Prettier, run in CI with tests and build
  (`.github/workflows/ci.yml`).
- Security headers on every page, including a Content-Security-Policy that allows no inline
  script except the ones Next.js writes, each marked with a per-request nonce.
- Condom catalogue API (`/api/v1/catalogue/products`, `/brands`, `/units`) with create, partial
  update, activate, deactivate and delete for unused records, behind the new `catalogue:manage`
  permission (admin and moh). Migration 18 converts legacy products, deactivating unrecognised
  ones and marking those without a unit or pack size as incomplete. See `docs/modules/catalogue.md`.
- The catalogue screens use that API: edit, activate, deactivate and delete products, brands and
  units, a Brands tab, status filters and an Incomplete badge for legacy products.
- Product types are managed catalogue records like brands and units (`/api/v1/catalogue/types`, a
  Types tab), instead of a fixed list. Migration 23 seeds Free, Socially marketed and Commercial,
  keeps every product's type and grants `catalogue:manage` to `nms` and `jms`. Products now send
  `type_id` and return `type` as `{ id, name }`.
- NMS and JMS manage the catalogue from the warehouse workspace (`/warehouse/catalogue`). Who may
  change it is the `catalogue:manage` switch under Users & access → Roles & permissions; a
  workspace opened read-only (MOH looking at the warehouse) shows the catalogue without changes.
- Every response carries an `X-Request-ID`, which the request log records.
- Store assignment: `GET /api/v1/locations/stores` lists the national warehouses and district
  stores, and accounts get a store on creation or through `PATCH /api/v1/users/{id}/store`
  (`users:update`). Migration 20 adds National Medical Stores and fills in missing stores for
  warehouse staff, DCFPs and delivery agents. In the web app, the new-user form sets the store from
  the role and district, and Users has a **Change store** action.
- The hotspot map runs on OpenStreetMap with MapLibre GL and reads the Go hotspot endpoints.
  Hotspots cluster into rings split by review status or dispenser state; a single hotspot is a
  pin carrying its venue's glyph. Heatmap and point views, a key that doubles as a filter,
  search, status, dispenser, venue and region filters, a list of the hotspots in view, and a
  detail panel with the contact person, directions, the nearest hotspots, comments and history. A
  national user's map loads district by district, so the database never pages through the whole
  table. The view is kept in the page address, and the hotspots shown export to Excel. The map is
  held to Uganda with the rest of the world dimmed, and draws only positions inside the country
  (with 3 km for border towns); missing, swapped and out-of-country positions are listed for
  correction instead. See `docs/modules/hotspots.md`.

### Changed

- The web app takes the place of the Next.js welcome page added in 2.0.0 and keeps its images,
  Compose services and `BACKEND_URL` rewrites. The frontend CI job also checks formatting, runs
  the tests with coverage and audits shipped dependencies, and the production image accepts an
  optional `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` build argument.
- Screen addresses are consistent and no longer misspelled (for example `/moh/users` instead of
  `/moh/admin/userManagment`).
- The district "Condom items" link opens the condom catalogue. It previously opened a copy of the
  orders placeholder.
- Dashboard figures and charts that are not read from the API are labelled "Sample".
- Hotspot status is chosen from a list (active, pending, inactive) instead of typed freely. A
  record saved with another status keeps it.
- Organisation units are chosen by name instead of entered as a numeric id.
- API validation errors are reported under JSON field names with readable messages
  (`"pieces_per_unit": "Must be at most 100,000."`) instead of Go field names and rule tags.
- New orders and stockout requests reject inactive products.
- A product's type is its distribution channel (free, socially marketed or commercial), and its
  brand is chosen from the brand list. The product minimum level is removed.
- The web app's hotspot screens follow the hotspot API: a DCFP activates or rejects a submitted
  hotspot and can deactivate an active one, each with a comment, and the separate verify step is
  gone. The VHT's submission form asks for what the API requires: type, region, district,
  subcounty, coordinates, and the hotspot manager's name and phone.
- The VHT district stockout migration is number 21. It was numbered 20, like the store assignment
  migration, which stopped migrations from running.
- The hotspot map no longer needs a Google Maps key: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is replaced
  by the optional `NEXT_PUBLIC_MAP_TILES` (empty for OpenStreetMap, `off`, or a tile server's URL)
  and `NEXT_PUBLIC_MAP_ATTRIBUTION`. The Content-Security-Policy names the tile servers instead of
  Google, and `Permissions-Policy` allows location on the app's own pages, for "show my location".
- The new Ministry of Health seal replaces the placeholder product icon in the web app (top bar,
  sign-in, onboarding and access screens, favicon and a new Apple touch icon) and the crest on the
  mobile sign-in screen. On a phone the web top bar shows the seal and "CLIMS"; the ministry's
  name stays for screen readers. The mobile splash screen and app icon keep the crest.

### Removed

- Template leftovers and duplicates from the prototype: dozens of unused or copied components and
  pages, the unlinked "JMS Duplicate" pages and hotspot verification stub, the "Other user" pages
  (a demo grid of fictional people), a US vector map with no data, and placeholder prose in
  Procurement.
- Header search, notification and message menus, which showed template content and did nothing.
- Date-range pickers on order screens, which filtered nothing.
- The "Export PDF" and "Send to MOH" buttons, which did nothing. User management gains a working
  Excel export.
- Ant Design, ApexCharts, styled-components, redux-persist, three unused data-grid libraries,
  webpack, and the `xlsx` package (unpatched advisories on npm).
- `@react-google-maps/api`, with the Google Maps scripts and hosts it needed.

### Security

- Every signed-in screen is behind the route guard. Previously no route was protected.
- The session token is attached to API requests in one place. A rejected token ends the session.
- Sign-out always ends the local session. Previously a network failure left the user signed in.
- Removed a Google Maps API key hardcoded in source; it is now build configuration. **The old key
  remains in the prototype repository's history and should be rotated or restricted.**
- The edit-user form no longer displays the user's existing password, and password fields are
  masked.
- Evidence upload no longer posts files to a third-party mock endpoint. It is switched off until
  the API can store documents.
- API responses are validated against schemas before use; server error details are never shown.
- New passwords must be at least 8 characters.
- Excel exports write text as text, so spreadsheet formulas in data cannot execute.
- The dashboard's hotlinked images and avatar service calls were removed; the app loads no
  third-party resources except Google Maps on the map page.

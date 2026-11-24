# Design system

The visual language of the CLIMS web app. Read this before adding or changing UI.

## Source

The look follows the [SalesOps Dashboard](https://v0.app/templates/salesops-dashboard-9q2Mfgu6cDi)
reference: a 260px sidebar with a green active marker, uppercase table headers, tinted status
chips, DM Sans. Components are shadcn/ui (`radix-nova` style, Radix primitives) on Tailwind CSS 4.

The CLIMS prototype refines it, and wins where the two differ: flat 10px cards, a green-tinted
table header, pill status chips and role colours. Its visual spec is
`design/prototype/CLIMS Theme.dc.html` (see `design/IMPLEMENTATION_PLAN.md`). The app is denser
than the prototype: people work through long lists all day, so controls, rows and gaps are a step
smaller than its 56px top bar and 36px controls (see Sizes).

The reference ships in dark mode only. **Light is this product's theme**: its hues re-pitched for
a white surface. Dark is available from the header toggle and uses the reference's own values. The
app never follows the operating system's preference.

## Tokens

Defined in `src/styles/globals.css`. Always use the token, never a raw colour.

| Token                          | Light                                | Use                                                             |
| ------------------------------ | ------------------------------------ | --------------------------------------------------------------- |
| `background`                   | `#f9fafb`                            | Page canvas; `bg-canvas` adds a faint primary glow at top right |
| `card`, `popover`              | `#ffffff`                            | Surfaces                                                        |
| `foreground`                   | `#0c0d0f`                            | Text                                                            |
| `muted-foreground`             | `#62666d`                            | Secondary text, placeholders (5.8:1 on card)                    |
| `secondary`, `muted`, `accent` | `#f2f3f5`                            | Quiet fills, hover and selected backgrounds                     |
| `border`                       | `#e4e6e9`                            | Card and divider hairlines                                      |
| `input`                        | `#8b9097`                            | Form field outlines (3.2:1, see below)                          |
| `primary`                      | `#45ba50`                            | **Fills only**: primary buttons, active page, progress, markers |
| `primary-foreground`           | `#020203`                            | Text on a primary fill (8.3:1)                                  |
| `success`                      | `#177534`                            | **Green text and icons**; positive status                       |
| `warning`                      | `#a84c06`                            | Caution status                                                  |
| `destructive`                  | `#b71c1c` (dark `#ff6b6a`)           | Errors, destructive actions, negative status                    |
| `info`                         | `#0a6a9b`                            | Informational status                                            |
| `ring`                         | `#2f9e42`                            | Focus ring                                                      |
| `chart-1` … `chart-5`          | blue, green, purple, orange, magenta | Chart series, in that fixed order                               |
| `table-head`                   | `primary` at 7% on `card`            | Table header band (opaque, so sticky cells cover rows)          |
| `role-*`                       | see below                            | Who did something, in timelines and activity feeds              |

Role colours: `role-hotspot-manager` `#1f8fd1`, `role-vht` `#7c5cd6`, `role-dcfp` `#45ba50`,
`role-warehouse` `#e08a2e`, `role-rider` `#c2418f`, `role-moh` (= `info`), `role-system` `#8b9097`.
They are the same in both themes except MOH, which follows `info`. A role dot always sits beside the
role's name: DCFP and warehouse are under 3:1 on white, so the colour may never be the only cue.

Radius is 8px (`rounded-lg`) for controls, 10px (`rounded-card`) for cards and 12px (`rounded-xl`)
for popovers and dialogs. Cards are flat: a 1px `border`, no shadow. Type is DM Sans, self-hosted;
numbers that are compared use `tabular-nums`.

### Sizes

| Thing        | Size                                                                                  |
| ------------ | ------------------------------------------------------------------------------------- |
| Sidebar      | 224px, 32px items; 48px collapsed to icons; a sheet below 768px                       |
| Top bar      | 48px (`h-header`), full width above the sidebar and the page                          |
| Heading band | 18px title, 13px description, 32px tabs                                               |
| Controls     | 32px standard (`default`, `icon`); 28px compact (`sm`, `icon-sm`) in tables, toolbars |
| Table cells  | 6 × 12px (2px in the View menu's compact rows; header 6 × 12px), 16px at the edges    |
| Status chips | 22px pill (`status-chip`), 10.5px bold capitals, a dot, a hairline of its own colour  |

Spacing runs on a 4px scale, and 12px carries the rhythm. It is the gap between a page's
sections and side-by-side columns (`gap-section`), and the same 12px as the gaps between stat
cards, so a row of cards and the columns under it share gutters. Cards (`Card`, `StatCard`,
`ChartCard`, `ShareList`) pad 16px at the sides and 12px at top and bottom, with 12px between
groups inside them. A page wrapper uses `gap-section`, never its own `gap-4` or `gap-6`. Density
comes from spacing and control height, not from shrinking what people read: body text, table
cells and inputs stay 14px. Only supporting text steps down (13px sidebar items and page
descriptions, 11px table header capitals).

Fill the space a short list leaves rather than stretching its card. A card in a grid takes the
height of its content (`items-start`), and the section below moves up into the gap, as the
warehouse dashboard's charts sit under its task list. A page's filters share one row with what
the page is about: the warehouse pages put the district menu (`DistrictSelect`) at the end of
the row naming the warehouse.

### Three rules that are easy to get wrong

1. **`primary` is a fill, `success` is text.** The reference green is 2.5:1 on white, which is
   fine behind near-black text and unreadable as text. Green words, links and icons use `success`.
2. **Field outlines use `input`, not `border`.** On a white card the outline is the only thing
   marking a field, so it carries 3:1. Cards and dividers keep the lighter `border`.
3. **Status colours pass on their own tint.** Chips are `bg-<status>/10 text-<status>`; each
   status colour was chosen so its text is at least 4.5:1 on that tint. The word carries the
   meaning; colour only reinforces it. There are five tones: positive (`success`), info, caution
   (`warning`), negative (`destructive`) and neutral. `StatusBadge` looks the tone up from the
   word (`lib/status.ts`); when a word's tone depends on context, as "Received" does, pass `tone`.

### Contrast

Measured (WCAG 2.x relative luminance; tints composited onto `card`) with a script over
`globals.css`. Text needs 4.5:1, icons, outlines and focus indicators 3:1. Re-measure if you
change a token.

| Pair                                                                                 | Light              | Dark               |
| ------------------------------------------------------------------------------------ | ------------------ | ------------------ |
| `muted-foreground` on `card` / `background`                                          | 5.8 / 5.5          | 6.3 / 6.4          |
| `muted-foreground` on `secondary`, `muted` (neutral chip)                            | 5.2                | 5.8                |
| `muted-foreground` on `table-head`                                                   | 5.4                | 5.9                |
| `muted-foreground` on `muted/50` (footers), `warning/5`, `destructive/5` (row tints) | 5.5, 5.4, 5.3      | 6.1, 6.0, 6.0      |
| `success` on `success/10` (positive chip, success alert, good trend)                 | 5.0                | 7.3                |
| `info` on `info/10`                                                                  | 5.1                | 7.7                |
| `warning` on `warning/10` (caution chip, warning alert, bad trend)                   | 4.9                | 7.7                |
| `destructive` on `destructive/10` (negative chip, button)                            | 5.6                | 6.7                |
| `destructive` on `destructive/20` (button hover light, button dark)                  | 4.6                | 5.7                |
| `destructive` on `destructive/30` (button hover, dark only)                          | —                  | 4.7                |
| `destructive/90` on `card` (destructive alert description)                           | 5.7                | 6.0                |
| `warning` / `destructive` text on their `/5` row tint                                | 5.3 / 6.0          | 8.2 / 7.0          |
| `foreground` on any status `/10` tint (alert descriptions)                           | 16.8               | 15.7               |
| `success` on `primary/10` (step numbers)                                             | 5.3                | 7.3                |
| `primary-foreground` on `primary` / `primary/80` (button, hover)                     | 8.3 / 10.0         | 8.3 / 5.5          |
| StatCard icons on `secondary`: info, success, warning, `chart-3`                     | 5.3, 5.2, 5.1, 3.8 | 7.9, 7.5, 7.9, 5.5 |
| `input` on `card` (field outline)                                                    | 3.2                | 3.3                |
| `ring` on `card` (focus indicator)                                                   | 3.5                | 8.1                |

`destructive` was darkened from `#c62828` (4.1:1 on its hover tint) and lifted in dark from
`#f14d4c` (4.0:1 on its dark hover tint). Two pairs stay under the line on purpose, and are never
the only cue: `primary` on white (2.5:1) is a fill behind words, and `ring` at 50% (1.8:1 light)
is only ever the halo around a solid 1px `ring` border. A focus indicator with no border uses a
solid ring: `focus-visible:ring-2 focus-visible:ring-ring`.

### The shell

Top bar (menu toggle, ministry seal and product name, notifications bell, theme, account), then
the sidebar and the page. The sidebar shows the current workspace's labelled sections; an item with things waiting
carries a count pill (a red dot when collapsed to icons), and the foot names the workspace. Under
the top bar, the heading band holds the page title, one line on what the page is for and, when a
section has several pages, its tabs. There is no breadcrumb: the sidebar shows where you are. A
record (a detail page) gets a "Back to <section>" link above its title instead. The band and the
page fill the width beside the sidebar; there is no maximum width. Tabs are links,
each to its own address. All of it comes from `navigation/workspaces.ts`; a page supplies only its
content and, at the top of it, its `PageActions`.

`accent` is deliberately neutral. The reference names its green "accent", but shadcn components
use `accent` for hover backgrounds, which must stay quiet. Its green is this system's `primary`.

### The seal

The Ministry of Health seal (`src/assets/moh-seal.png`, cut from the ministry's artwork) is the
only mark. It sits at 28px in the top bar and at 44px in `Brand`, on the sign-in, onboarding and
access screens; the favicon and touch icon are made from the same artwork. Show it as supplied:
never recolour, crop or outline it, and put it on no plate (its outer black ring is its edge in
both themes). Beside the ministry's name it is decorative (`alt=""`); on its own its alt text is
"Ministry of Health, Uganda".

## Building blocks

Reach for these before writing markup.

| Need                        | Use                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Page-level buttons          | `components/PageActions` (title and description come from the table)                                             |
| Any table                   | `components/data-table/DataTable`: the only table. See "Tables" below                                            |
| Per-row actions             | `components/data-table/RowActions` (`ROW_ACTION_SEPARATOR` groups items)                                         |
| A headline figure           | `components/StatCard` in a `StatCardGrid` (`trend` adds change and line; `detail` one line of what is behind it) |
| A stock figure              | No unit, since stock is in pieces: `formatStock`, `productName` (warehouse `summary.ts`) name any other unit     |
| An amount in several units  | `StatCard` `extra`: the unit holding most is the figure, the rest one quieter line under it; never add units     |
| Things to do                | `components/TaskList` (status, title, detail, a button to where it is done; lays out by its own width)           |
| A record's ID and status    | `components/DetailHeader` (progress goes in its band)                                                            |
| A record's progress         | `components/StepTracker` (state in words above each step)                                                        |
| History or recent events    | `components/ActivityTimeline` (`connected` or `compact`; role dots)                                              |
| Needed vs in stock          | `features/inventory/checkStock` and `StockCheckBadge`                                                            |
| A create or edit form       | `components/form/FormDialog` with `TextField` and `SelectField`                                                  |
| A choice from hundreds      | `components/form/ComboboxField` (a select with a search box; label + hint)                                       |
| Confirming a deletion       | `components/ConfirmDialog` (an alert dialog, never a plain dialog)                                               |
| A page still loading        | `components/states/PageSkeleton` (`table`, `dashboard`, `detail`, `form`, `stockout`)                            |
| Nothing to show             | `components/states/EmptyState`                                                                                   |
| Failed to load              | `components/states/ErrorState` (says what failed, offers retry)                                                  |
| A status word               | `components/StatusBadge` (`tone` overrides the word's lookup)                                                    |
| Change over time            | `components/charts/TrendChart` (`kind="line"` for overlapping series, `reference` for a target)                  |
| Periods or a few categories | `components/charts/ColumnChart` (one series, or several clustered or `stacked`)                                  |
| Ranked categories           | `components/charts/BarChart` (horizontal, largest first, top 10 with the rest in focus mode; `highlight`)        |
| A pipeline narrowing        | `components/charts/FunnelChart` (requested → approved → issued → received)                                       |
| One rate against a target   | `components/charts/GaugeChart` (status fill, target tick, the status in words)                                   |
| One whole split in parts    | `components/charts/SegmentedBar` (statuses, expiry bands; every share printed), or `ShareList`; never a donut    |
| A number column as a chart  | `components/charts/DataBar` in a `DataTable` cell                                                                |
| Report filters              | `features/analytics/FilterBar` with `useReportFilters` (period, district, type… in the address, with chips)      |
| A PDF of the page           | `components/reports/PdfButton` (reads `data-kpi`, `data-visual`, `data-pdf-table` inside `targetRef`)            |
| A figure that is not live   | `SampleBadge` on it, or `SampleDataNotice` for a whole page                                                      |

### Tables

Every table is `DataTable`, so every table looks and behaves the same. Users & access
(`features/users/UsersPage`) is the reference screen for a list.

- **`variant="list"`** (the default) is a page's records in their own card: search, sorting,
  paging, the View menu (columns, row height, rows per page) and every state. Give it a
  `preferencesKey` so the viewer's View choices are remembered. Filters go in `toolbar`;
  `FilterTabs` for a status sits above it. Mark secondary columns `hideable`, and those few people
  need `defaultHidden`, so the table fits 1440px without scrolling sideways.
- **`variant="embedded"`** is a short, fixed set of lines inside a card: an order's products, the
  batches a dispatch takes, a report's figures, a chart's table view. It shows every row, has no
  toolbar and no card of its own, and its cells may hold inputs. A column without `value` is a
  column of inputs or buttons: never sorted, searched or exported.
- **Scale.** Lists search, sort and page in the browser, over a search index built once per data
  load, so tens of thousands of rows (every hotspot) stay instant. At 50 or 100 rows a page the
  table scrolls inside its card and the header stays in view. An endpoint that pages (at most 100
  a time) uses `more` with a "Load more" button, and the count says how many are loaded, never
  pretending the first page is everything (the warehouse ledger, `useMovementLedger`). Ticking the
  page offers "Select all N".
- **Detail and totals.** `renderExpanded` opens a row onto its detail (an audit entry's changes, a
  product's batches); the chevron is a real button with `aria-expanded`. A column's `total` sums
  every matching row, not just the page, in the footer; amounts in different units are listed per
  unit, never added. `rowTone` tints a row (`caution`, `negative`, `muted`) and the row still says
  why in words.

`components/ui/` is generated by the shadcn CLI (`npx shadcn@latest add <name>`). Edit a
primitive only to align it with the tokens above, and keep the edit small so
`npx shadcn@latest diff` stays readable.

## Every screen has

- **A page title** in the heading band (from the navigation table) and one line under it saying what the page
  is for.
- **All five states**: loading (skeletons shaped like the content), empty (with the next step),
  error (what failed, how to recover), partial (missing values show `—`), and populated.
- **Honest data.** A number that is not read from the API is marked as sample data. See the README.
- **Copy that names things.** Buttons say what they do ("Delete user", not "OK"). Errors say what
  happened and what to do next. Sentence case throughout.

## Charts

Report visuals follow Power BI's and Superset's conventions, so people who use those tools read them
at once: every chart sits in `ChartCard`, whose header holds the title and description, the legend,
and the visual's options (table view, focus mode, and a "More options" menu to download the data as
CSV or the chart as a PNG). A chart has a loading skeleton, an empty state that says why in the
report's words, and an error state that says the figures are not zero. Filters sit in one bar above
every visual they scope (`FilterBar`), never inside a card.

- Colour comes last, in the fixed `chart-1…5` order. A series keeps its colour when others are
  filtered out. Red is not a series colour; it is reserved for `destructive`.
- States are not series: notification statuses, expiry bands and dispenser conditions take the
  status tokens (with text in `var(--card)` on them, which contrasts in both themes), and the word is
  always printed beside the colour. Conditional formatting (`BarChart` `highlight`) uses `warning`
  for a bar under a guideline, and the footer says what orange means.
- One y-axis only: two measures of different scale are two charts. Headline piece counts switch to
  display units from 100,000 (`piecesValue`: "519.6K pcs") so a card's figure stays on one line;
  the table view and downloads keep the exact figure.
- Charts animate only without `prefers-reduced-motion`. A refetch keeps the previous figures on
  screen (`keepPrevious`) instead of flashing the skeleton.
- 2px lines, area fill at 10%, columns at most 24px wide with a 4px rounded top, solid hairline
  grid, one y-axis as wide as its longest label (`width="auto"`, so "60,000" is never clipped).
  The plot is 200px tall.
- Two or more series get a legend; one series is named by the card title.
- Every chart has a tooltip and a table view (`ChartCard` provides the switch), so no value is
  reachable only by hovering.
- Text in a chart uses text tokens, never the series colour.

The light and dark series colours were checked for colour-vision separation and 3:1 against their
surface. If you change one, check the set again.

## Maps

The hotspot map (`features/hotspots/map`) is the one map. Extend it rather than adding another.

- **The base map is context, not content.** OpenStreetMap tiles are desaturated in light and
  inverted (with the hue turned back, so water stays blue) in dark, so the hotspots carry the
  colour.
- **Uganda is the subject.** The map is held to the country, everything outside the border is
  dimmed with `background`, and the border is a `foreground` line.
- **A hotspot is a pin.** A white-edged teardrop in its category colour, tip on the position, with
  the venue's lucide glyph inside (`map/pins.ts`; a dot when the type is unknown). The glyph takes
  white or near-black, whichever contrasts more with the fill. Pins are fills: active and a
  working dispenser take `primary`; the other states take the status colours (`warning`,
  `destructive`, `info`, neutral `role-system`). WebGL cannot read CSS, so `map/palette.ts` reads
  the tokens and reads them again when the theme changes. Never write a hex value for a marker.
  Across the whole country the points style uses small dots; pins take over at town level.
- **Clusters are rings** split by the same categories, with the count inside. Each is a real
  button whose name says what it holds in words.
- **The key is a filter.** Its tabs choose what colour means; each entry switches its hotspots on
  and off.
- **The list beside the map is the accessible route.** Everything on the map is reachable from it
  by keyboard. Colour never stands alone: rows carry a chip for every state except the usual one
  (active), and the hover label and detail panel name the state.
- Overlays on the map are `bg-card/95` panels with a 1px border and a small shadow, so they stay
  legible over any tile.

## Accessibility

Target: WCAG 2.2 AA.

- **Headings.** `h1` is the heading band's title. Sections are `h2`: `CardTitle` and `DetailHeader`
  render one. A card inside a section that already has an `h2` passes its own level:
  `<CardTitle asChild><h3>…</h3></CardTitle>`.
- **Focus after an action.** When a button removes itself (confirming an order, receiving stock,
  following a link inside the page), focus would drop to the page body. `hooks/useFocusWhenLost`
  moves it to the element that says what happened: the shell's `main` after a route change, a
  detail page's status banner (`tabIndex={-1}`) after its status changes. A failed submit focuses
  the first field to fix; its message is linked with `aria-describedby`.
- **Announcements.** `Alert` `default` and `destructive` are `role="alert"`; the tinted variants
  are `role="status"`. A message that is on the page from the start is not a live region:
  `SampleDataNotice` is `role="note"`. A spinner inside a button that also changes its label is
  `aria-hidden`.
- **Colour is never alone.** Status chips carry the word, expiry dates add a warning icon and
  "near expiry" for screen readers, stock bars sit beside "Above minimum" / "Below minimum".
- **Target size.** Controls are at least 24px (`icon-xs`, `xs`). The 16px checkbox and radio are
  always inside their `<label>`, which is the target.

## PDF reports

`PdfButton` makes an A4 document of the part of the page in its `targetRef`: the ministry's seal and
the title, the period and filters (read from `FilterBar`), the scope and data time, the headline
figures (`StatCard` marks itself `data-kpi`), a picture of every `ChartCard` (`data-visual`, taken in
the light theme whatever the viewer's), lists marked `data-pdf-table` (a `TaskList` does), any tables
passed in (a report's records, on landscape pages when wide), the definitions, and page numbers.
jsPDF and html-to-image load only when someone downloads.

## Print

`window.print()` prints the page without the shell (`globals.css`, `@media print`): the top bar,
sidebar, skip link, every `Button`, toasts and anything marked `data-print-hide`
(`SampleDataNotice`, `PageActions`) are left out, and colours switch to the light values on white
whatever the theme. When the page marks one element `data-print-region`, only that element prints,
at full width: the delivery note on the dispatch page and the goods received note on a warehouse
request. A document a user is expected to print should be one such region.

## Before a screen ships

1. Look at it in a browser at about 1440, 768 and 390px wide, in both themes.
2. Run it against `MOCK_DATA=worst` and `MOCK_DATA=empty`. Nothing may overflow the page, hide a
   row's actions, or print `null`, `undefined` or `NaN`.
3. Tab through it. Every control is reachable, shows focus, and has a name. Dialogs trap focus and
   Escape closes them.
4. Make each request fail (`MOCK_FAIL=<resource>`) and check the message is useful and safe.
5. Check the browser console is empty.

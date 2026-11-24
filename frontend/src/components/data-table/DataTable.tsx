import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  Inbox,
  RefreshCw,
  Search,
  SearchX,
  X,
} from 'lucide-react';
import {
  Fragment,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getErrorMessage } from '@/lib/api';
import { matchesFilter, type ColumnFilter, type FilterKind } from '@/lib/table/columnFilters';
import { formatNumber, formatText } from '@/lib/format';
import {
  nextSort,
  paginate,
  searchIndex,
  sortRows,
  type CellValue,
  type SortState,
} from '@/lib/table/tableModel';
import { cn } from '@/lib/utils';

import { TableFooterBar, type DataTableMore } from './TableFooterBar';
import { TableFilters, ActiveTableFilters, type FilterColumn } from './TableFilters';
import { TableViewMenu } from './TableViewMenu';
import { useTablePreferences, type TableDensity } from './useTablePreferences';

export type { DataTableMore } from './TableFooterBar';

export interface DataTableColumn<Row> {
  id: string;
  header: string;
  /**
   * The value sorted, searched and exported; also what is shown unless `cell`
   * is given. Leave it out for a column of inputs or buttons: such a column is
   * not sorted, searched or exported.
   */
  value?: (row: Row) => CellValue;
  /** Custom rendering, e.g. a badge. Sorting and search still use `value`. */
  cell?: (row: Row) => ReactNode;
  /** Defaults to true in a list and false in an embedded table. Needs `value`. */
  sortable?: boolean;
  /** List columns default to text (numbers when `numeric`). Use select for categories or date for ISO dates. */
  filter?: FilterKind | false;
  /** Right-aligns numeric columns so digits line up. */
  numeric?: boolean;
  /** Offered in the View menu, so a viewer can hide it. */
  hideable?: boolean;
  /** Starts hidden until the viewer shows it. Implies `hideable`. */
  defaultHidden?: boolean;
  /** Hides the header text visually, e.g. over a column of buttons. */
  srOnlyHeader?: boolean;
  /** Lets the cell wrap onto several lines instead of clipping to one. */
  wrap?: boolean;
  /**
   * A figure for the footer, worked out over every row that matches the
   * search (all pages, not just the one showing), e.g. the stock on hand.
   */
  total?: (rows: readonly Row[]) => ReactNode;
}

/** Ticked rows, by id, for actions on several rows at once. */
export interface DataTableSelection<Row> {
  selected: ReadonlySet<string>;
  onChange: (selected: Set<string>) => void;
  /** Names a row in its checkbox's label, e.g. the user's name. */
  rowLabel: (row: Row) => string;
  /** What the rows are, plural and lower case, e.g. "users". Defaults to "rows". */
  noun?: string;
}

/** Marks a row, e.g. one that cannot be used or needs attention. */
export type DataTableRowTone = 'default' | 'muted' | 'caution' | 'negative';

interface DataTableProps<Row> {
  /** Names the table for assistive technology, e.g. "Users". */
  label: string;
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[] | undefined;
  getRowId: (row: Row) => string | number;
  /**
   * `list` (the default) is a page's list of records: search, sorting, paging,
   * the View menu, its own card. `embedded` is a short, fixed set of lines
   * inside a card (an order's products, the batches to pick, a form's figures):
   * every row, no toolbar, no card of its own, and cells may hold inputs.
   */
  variant?: 'list' | 'embedded';
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  isRetrying?: boolean;
  searchPlaceholder?: string;
  /** Shown when there are no rows at all. */
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  /** Renders the trailing actions cell for a row. */
  rowActions?: (row: Row) => ReactNode;
  pageSize?: number;
  /** Adds a checkbox to each row and the header, for bulk actions. */
  selection?: DataTableSelection<Row>;
  /** Filters or other controls, beside the search box. */
  toolbar?: ReactNode;
  /**
   * Remembers the viewer's View menu choices (columns, row height, rows per
   * page) in this browser under this key, e.g. "users". Without it the choices
   * last while the table is on screen.
   */
  preferencesKey?: string;
  /** The order rows start in, before the viewer sorts. */
  defaultSort?: SortState;
  /** A row's detail, shown under it when its chevron is pressed, e.g. its batches. */
  renderExpanded?: (row: Row) => ReactNode;
  /** Names the chevron for a row, e.g. "Show batches of Lifeguard". */
  expandLabel?: (row: Row) => string;
  rowTone?: (row: Row) => DataTableRowTone;
  /** For a list the server pages: offers to load the next batch, and says the count is partial. */
  more?: DataTableMore;
  className?: string;
}

const isHideable = (column: {
  hideable?: boolean;
  defaultHidden?: boolean;
  value?: unknown;
  srOnlyHeader?: boolean;
}) => column.hideable !== false && column.value !== undefined && !column.srOnlyHeader;

const DENSITY_CLASSES: Record<TableDensity, string> = {
  comfortable: 'py-2.5',
  compact: 'py-1',
};

const ROW_TONES: Record<DataTableRowTone, string> = {
  default: '',
  muted: 'text-muted-foreground',
  caution: 'bg-warning/5',
  negative: 'bg-destructive/5',
};

/** A native checkbox that can also show "some ticked", which only a property can set. */
function SelectCheckbox({
  checked,
  indeterminate = false,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: () => void;
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    // The label is the 28px target around the 16px box.
    <label htmlFor={id} className="-m-1.5 flex size-7 cursor-pointer items-center justify-center">
      <Checkbox
        id={id}
        ref={ref}
        checked={checked}
        aria-checked={indeterminate ? 'mixed' : checked}
        aria-label={label}
        onChange={onChange}
      />
    </label>
  );
}

const SKELETON_ROWS = 5;
const NO_ROWS: readonly never[] = [];
/**
 * Keeps the row menu in view while a wide table scrolls sideways, so acting on
 * a row never requires scrolling to find its controls.
 */
const STICKY_ACTIONS_CLASS = 'sticky right-0 z-10';
/** Cells are 6 × 12px (2px when compact), with 16px at the table's outer edges. */
const EDGE_CLASS = 'px-3 first:pl-4 last:pr-4';
const HEAD_CLASS = cn(EDGE_CLASS, 'text-muted-foreground h-10 py-2 text-xs font-semibold');
/**
 * From 50 rows a page the table is taller than the screen, so it scrolls inside
 * its card and the header stays in view; shorter pages scroll with the page.
 */
const LONG_PAGE = 50;

/** A safe fragment of an element id from a row id ("a1:b2" → "a1_b2"). */
const idFragment = (id: string) => id.replace(/[^\w-]/g, '_');

/**
 * The one table of the app. As a `list` it searches, sorts and pages in the
 * browser over the rows it is given (the API returns whole lists, or pages a
 * list loads with `more`). As `embedded` it lays out a card's line items in the
 * same style. Users & access is the reference screen for a list.
 */
export function DataTable<Row>({
  label,
  columns,
  rows,
  getRowId,
  variant = 'list',
  isLoading = false,
  error,
  onRetry,
  isRetrying,
  searchPlaceholder = 'Search…',
  emptyTitle,
  emptyDescription,
  emptyAction,
  rowActions,
  pageSize = 10,
  selection,
  toolbar,
  preferencesKey,
  defaultSort,
  renderExpanded,
  expandLabel,
  rowTone,
  more,
  className,
}: DataTableProps<Row>) {
  const embedded = variant === 'embedded';
  const tableId = useId();
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ColumnFilter[]>([]);
  // Typing stays responsive on a long list: the filter catches up a frame later.
  const searched = useDeferredValue(query);
  const [sort, setSort] = useState<SortState | null>(defaultSort ?? null);
  const [requestedPage, setRequestedPage] = useState(1);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const hideable = columns.filter(isHideable);
  const [preferences, setPreferences] = useTablePreferences(preferencesKey, {
    hidden: columns.filter((column) => column.defaultHidden).map((column) => column.id),
    density: 'comfortable',
    pageSize,
  });
  const hidden = new Set(preferences.hidden);
  // Stale preferences must never produce a table with no readable columns.
  if (
    columns.length > 0 &&
    columns.every((column) => isHideable(column) && hidden.has(column.id))
  ) {
    hidden.delete(columns[0]?.id ?? '');
  }
  const shownColumns = columns.filter((column) => !isHideable(column) || !hidden.has(column.id));
  const rowPadding = embedded ? 'py-1.5' : DENSITY_CLASSES[preferences.density];
  const canSort = (column: DataTableColumn<Row>) =>
    column.value !== undefined && (column.sortable ?? !embedded);

  const all = rows ?? NO_ROWS;
  const filterColumns = useMemo<FilterColumn[]>(
    () =>
      columns.flatMap((column) => {
        if (!column.value || column.filter === false || column.srOnlyHeader) return [];
        const kind = column.filter || (column.numeric ? 'number' : 'text');
        const options =
          kind === 'select'
            ? [
                ...new Set(
                  all
                    .map((row) => column.value?.(row))
                    .filter(
                      (value) =>
                        value !== null && value !== undefined && String(value).trim() !== '',
                    )
                    .map(String),
                ),
              ].sort((a, b) => a.localeCompare(b))
            : undefined;
        return [{ id: column.id, header: column.header, kind, options }];
      }),
    [columns, all],
  );
  const activeFilters = filters.filter((filter) =>
    filterColumns.some((column) => column.id === filter.columnId),
  );
  const changeFilters = (next: ColumnFilter[]) => {
    setFilters(next);
    setRequestedPage(1);
  };
  const clearFilters = () => {
    setQuery('');
    changeFilters([]);
  };

  // Hidden columns are still searched: hiding a column tidies the view, it does not narrow it.
  const index = useMemo(
    () => searchIndex(all, (row) => columns.map((column) => column.value?.(row))),
    [all, columns],
  );
  const matching = useMemo(
    () =>
      sortRows(
        index.search(searched).filter((row) =>
          filters.every((filter) => {
            const column = columns.find(
              (item) => item.id === filter.columnId && item.filter !== false,
            );
            return !column?.value || matchesFilter(column.value(row), filter.rule);
          }),
        ),
        sort,
        (row, columnId) => columns.find((column) => column.id === columnId)?.value?.(row),
      ),
    [index, searched, sort, columns, filters],
  );
  const page = embedded
    ? paginate(matching, 1, Math.max(1, matching.length))
    : paginate(matching, requestedPage, preferences.pageSize);

  const leading = (selection ? 1 : 0) + (renderExpanded ? 1 : 0);
  const columnCount = leading + shownColumns.length + (rowActions ? 1 : 0);
  const hasRows = all.length > 0;
  const showError = Boolean(error) && !hasRows;
  const isLong = !embedded && page.rows.length >= LONG_PAGE;
  const hasTotals = page.total > 0 && shownColumns.some((column) => column.total);
  const isSearching = searched.trim() !== '' || activeFilters.length > 0;

  const idOf = (row: Row) => String(getRowId(row));
  const pageIds = page.rows.map(idOf);
  const pageSelected = selection ? pageIds.filter((id) => selection.selected.has(id)).length : 0;
  const pageAllSelected = pageIds.length > 0 && pageSelected === pageIds.length;
  const matchingIds = selection && pageAllSelected ? matching.map(idOf) : [];
  const allMatchingSelected = matchingIds.every((id) => selection?.selected.has(id));
  const selectionNoun = selection?.noun ?? 'rows';

  const toggleRow = (id: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.onChange(next);
  };
  const togglePage = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    for (const id of pageIds) {
      if (pageAllSelected) next.delete(id);
      else next.add(id);
    }
    selection.onChange(next);
  };
  const toggleExpanded = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalLabel = more?.hasMore
    ? `Total of the ${formatNumber(page.total)} loaded`
    : isSearching
      ? `Total of ${formatNumber(page.total)} matching`
      : `Total of all ${formatNumber(page.total)}`;

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col',
        !embedded && 'bg-card rounded-card overflow-hidden border shadow-xs',
        className,
      )}
    >
      {!embedded && (isLoading || hasRows || toolbar) ? (
        <div
          data-print-hide
          className="bg-muted/15 flex flex-wrap items-center gap-2 border-b px-4 py-3"
        >
          <div className="relative w-full sm:max-w-xs">
            <label htmlFor={searchId} className="sr-only">
              Search {label.toLowerCase()}
            </label>
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              id={searchId}
              type="search"
              name="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setRequestedPage(1);
              }}
              placeholder={searchPlaceholder}
              autoComplete="off"
              className="bg-card pl-8"
              disabled={!hasRows}
            />
          </div>
          <TableFilters
            label={label}
            columns={filterColumns}
            filters={activeFilters}
            onChange={changeFilters}
          />
          {toolbar}
          <div className="flex items-center gap-2 sm:ml-auto">
            {onRetry ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Refresh ${label.toLowerCase()}`}
                disabled={isLoading || isRetrying}
                onClick={onRetry}
              >
                <RefreshCw
                  className={cn(isRetrying && 'animate-spin motion-reduce:animate-none')}
                  aria-hidden="true"
                />
              </Button>
            ) : null}
            <TableViewMenu
              label={label}
              columns={hideable}
              preferences={{ ...preferences, hidden: [...hidden] }}
              hasFixedColumns={columns.some((column) => !isHideable(column))}
              onChange={(change) => {
                setPreferences(change);
                if (change.pageSize) setRequestedPage(1);
              }}
            />
          </div>
        </div>
      ) : null}

      {!embedded && (query || activeFilters.length > 0) ? (
        <div
          className="flex flex-wrap items-center gap-2 border-b px-4 py-2"
          aria-label="Active table filters"
        >
          <span className="text-muted-foreground mr-1 text-xs tabular-nums" aria-live="polite">
            {formatNumber(matching.length)} matching{more?.hasMore ? ' loaded records' : ' records'}
          </span>
          {query ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="max-w-full"
              aria-label={`Search: ${query}. Remove filter`}
              data-print-text
              onClick={() => {
                setQuery('');
                setRequestedPage(1);
              }}
            >
              <span className="truncate">Search: {query}</span>
              <X aria-hidden="true" />
            </Button>
          ) : null}
          <ActiveTableFilters
            columns={filterColumns}
            filters={activeFilters}
            onChange={changeFilters}
          />
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            Clear all filters
          </Button>
        </div>
      ) : null}
      {Boolean(error) && hasRows ? (
        <Alert variant="warning" className="rounded-none border-x-0 border-t-0">
          <AlertTitle>Could not refresh {label.toLowerCase()}</AlertTitle>
          <AlertDescription>
            Showing the last loaded records. {getErrorMessage(error)}
            {onRetry ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                disabled={isRetrying}
                onClick={onRetry}
              >
                Try again
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="min-w-0">
        {showError ? (
          <ErrorState
            title={`Could not load ${label.toLowerCase()}`}
            error={error}
            onRetry={onRetry}
            isRetrying={isRetrying}
          />
        ) : (
          <>
            {selection && pageAllSelected && matching.length > page.rows.length ? (
              <div
                role="status"
                className="bg-primary/5 flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-1.5 text-[0.8125rem]"
              >
                {allMatchingSelected ? (
                  <>
                    <span>
                      All {formatNumber(matching.length)} {selectionNoun} are selected.
                    </span>
                    <Button
                      variant="link"
                      size="xs"
                      className="h-auto p-0 text-[0.8125rem]"
                      onClick={() => {
                        selection.onChange(new Set());
                      }}
                    >
                      Clear selection
                    </Button>
                  </>
                ) : (
                  <>
                    <span>
                      All {formatNumber(page.rows.length)} {selectionNoun} on this page are
                      selected.
                    </span>
                    <Button
                      variant="link"
                      size="xs"
                      className="h-auto p-0 text-[0.8125rem]"
                      onClick={() => {
                        selection.onChange(new Set([...selection.selected, ...matchingIds]));
                      }}
                    >
                      Select all {formatNumber(matching.length)} {selectionNoun}
                    </Button>
                  </>
                )}
              </div>
            ) : null}

            <div
              data-slot="table-container"
              className={cn(
                'relative w-full overflow-x-auto',
                isLong && 'max-h-[calc(100dvh-12rem)] min-h-80 overflow-y-auto',
              )}
            >
              <table
                id={tableId}
                data-slot="table"
                aria-label={label}
                aria-busy={isLoading}
                className="w-full caption-bottom text-sm"
              >
                <TableHeader className={cn(isLong && 'sticky top-0 z-20')}>
                  <TableRow className="bg-table-head hover:bg-table-head">
                    {selection ? (
                      <TableHead className={cn(HEAD_CLASS, 'w-px')}>
                        <SelectCheckbox
                          checked={pageAllSelected}
                          indeterminate={pageSelected > 0 && !pageAllSelected}
                          label={`Select every ${label.toLowerCase()} row on this page`}
                          onChange={togglePage}
                        />
                      </TableHead>
                    ) : null}
                    {renderExpanded ? (
                      <TableHead className={cn(HEAD_CLASS, 'w-px pr-0')}>
                        <span className="sr-only">Details</span>
                      </TableHead>
                    ) : null}
                    {shownColumns.map((column) => {
                      const sorted = sort?.columnId === column.id ? sort.direction : null;
                      const SortIcon =
                        sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ArrowUpDown;
                      return (
                        <TableHead
                          key={column.id}
                          className={cn(HEAD_CLASS, column.numeric && 'text-right')}
                          aria-sort={
                            sorted === 'asc'
                              ? 'ascending'
                              : sorted === 'desc'
                                ? 'descending'
                                : undefined
                          }
                        >
                          {column.srOnlyHeader ? (
                            <span className="sr-only">{column.header}</span>
                          ) : !canSort(column) ? (
                            column.header
                          ) : (
                            <Button
                              data-print-text
                              variant="ghost"
                              size="sm"
                              type="button"
                              onClick={() => {
                                setSort((current) => nextSort(current, column.id));
                              }}
                              className={cn(
                                'hover:text-foreground -mx-2 h-7 gap-1.5 px-2 text-xs font-semibold',
                                sorted && 'text-foreground',
                              )}
                            >
                              {column.header}
                              <SortIcon className="size-3" aria-hidden="true" />
                            </Button>
                          )}
                        </TableHead>
                      );
                    })}
                    {rowActions ? (
                      <TableHead
                        className={cn(HEAD_CLASS, STICKY_ACTIONS_CLASS, 'bg-table-head w-px')}
                      >
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {isLoading && !hasRows ? (
                    Array.from({ length: SKELETON_ROWS }, (_, rowIndex) => (
                      <TableRow key={rowIndex} aria-hidden="true" className="hover:bg-transparent">
                        {Array.from({ length: columnCount }, (_, cellIndex) => (
                          <TableCell key={cellIndex} className={cn(EDGE_CLASS, rowPadding)}>
                            <Skeleton
                              className={cn(
                                'h-3.5 max-w-32',
                                ['w-3/4', 'w-1/2', 'w-5/6', 'w-2/3'][(rowIndex + cellIndex) % 4],
                              )}
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : page.total === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={columnCount} className="p-0 whitespace-normal">
                        {embedded ? (
                          <p className="text-muted-foreground px-4 py-4 text-center text-sm">
                            {emptyTitle ?? `No ${label.toLowerCase()} yet`}
                            {emptyDescription ? ` ${emptyDescription}` : null}
                          </p>
                        ) : hasRows ? (
                          <EmptyState
                            icon={SearchX}
                            title="No matches"
                            description={
                              activeFilters.length > 0
                                ? `No records match these filters.${more?.hasMore ? ' Filters cover loaded records only. Load more to search further back.' : ' Try removing a filter or changing its value.'}`
                                : more?.hasMore
                                  ? `Nothing in the ${formatNumber(all.length)} ${more.noun} loaded so far matches “${searched.trim()}”. Load more to search further back, or clear the search.`
                                  : `Nothing matches “${searched.trim()}”. Check the spelling or clear the search.`
                            }
                            action={
                              <div className="flex flex-wrap justify-center gap-2">
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    clearFilters();
                                  }}
                                >
                                  {activeFilters.length > 0 ? 'Clear filters' : 'Clear search'}
                                </Button>
                                {more?.hasMore ? (
                                  <Button
                                    variant="outline"
                                    disabled={more.isLoading}
                                    onClick={more.onLoadMore}
                                  >
                                    Load more {more.noun}
                                  </Button>
                                ) : null}
                              </div>
                            }
                          />
                        ) : (
                          <EmptyState
                            icon={Inbox}
                            title={emptyTitle ?? `No ${label.toLowerCase()} yet`}
                            description={emptyDescription}
                            action={emptyAction}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  ) : (
                    page.rows.map((row) => {
                      const id = idOf(row);
                      const isSelected = selection?.selected.has(id) ?? false;
                      const isOpen = renderExpanded !== undefined && expanded.has(id);
                      const detailId = `${tableId}-${idFragment(id)}-detail`;
                      return (
                        <Fragment key={id}>
                          <TableRow
                            aria-selected={selection ? isSelected : undefined}
                            data-state={isSelected ? 'selected' : undefined}
                            className={cn(
                              ROW_TONES[rowTone?.(row) ?? 'default'],
                              embedded && 'hover:bg-transparent',
                              isSelected && 'bg-primary/5 hover:bg-primary/8',
                              isOpen && 'border-b-0',
                            )}
                          >
                            {selection ? (
                              <TableCell className={cn(EDGE_CLASS, rowPadding, 'w-px')}>
                                <SelectCheckbox
                                  checked={isSelected}
                                  label={`Select ${selection.rowLabel(row)}`}
                                  onChange={() => {
                                    toggleRow(id);
                                  }}
                                />
                              </TableCell>
                            ) : null}
                            {renderExpanded ? (
                              <TableCell className={cn(EDGE_CLASS, 'w-px py-0 pr-0')}>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  className="text-muted-foreground"
                                  aria-expanded={isOpen}
                                  aria-controls={isOpen ? detailId : undefined}
                                  aria-label={expandLabel?.(row) ?? 'Show details'}
                                  onClick={() => {
                                    toggleExpanded(id);
                                  }}
                                >
                                  <ChevronRight
                                    aria-hidden="true"
                                    className={cn(
                                      'transition-transform duration-150 ease-out motion-reduce:transition-none',
                                      isOpen && 'rotate-90',
                                    )}
                                  />
                                </Button>
                              </TableCell>
                            ) : null}
                            {shownColumns.map((column) => (
                              <TableCell
                                key={column.id}
                                className={cn(
                                  EDGE_CLASS,
                                  rowPadding,
                                  embedded
                                    ? 'align-top'
                                    : column.wrap
                                      ? 'whitespace-normal'
                                      : 'max-w-64 truncate',
                                  column.numeric && 'text-right tabular-nums',
                                )}
                              >
                                {column.cell ? (
                                  column.cell(row)
                                ) : column.value ? (
                                  // Long values are clipped to keep rows one line tall;
                                  // the full text stays available on hover.
                                  <span title={formatText(column.value(row))}>
                                    {formatText(column.value(row))}
                                  </span>
                                ) : null}
                              </TableCell>
                            ))}
                            {rowActions ? (
                              <TableCell
                                className={cn(
                                  STICKY_ACTIONS_CLASS,
                                  EDGE_CLASS,
                                  'bg-card py-0 text-right',
                                  // Opaque, so the sticky cell still covers what scrolls under it.
                                  isSelected &&
                                    'bg-[color-mix(in_oklab,var(--color-primary)_5%,var(--color-card))]',
                                )}
                              >
                                {rowActions(row)}
                              </TableCell>
                            ) : null}
                          </TableRow>
                          {isOpen ? (
                            <TableRow id={detailId} className="bg-muted/40 hover:bg-muted/40">
                              <TableCell colSpan={columnCount} className="p-0 whitespace-normal">
                                <div className="py-3 pr-4 pl-4 sm:pl-12">{renderExpanded(row)}</div>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </Fragment>
                      );
                    })
                  )}
                </TableBody>

                {hasTotals ? (
                  <TableFooter className="bg-muted/50">
                    <TableRow className="hover:bg-transparent">
                      {leading > 0 ? <TableCell colSpan={leading} className="w-px" /> : null}
                      {shownColumns.map((column, columnIndex) => (
                        <TableCell
                          key={column.id}
                          className={cn(
                            EDGE_CLASS,
                            rowPadding,
                            column.numeric && 'text-right tabular-nums',
                            columnIndex === 0 && !column.total && 'text-muted-foreground',
                          )}
                        >
                          {column.total
                            ? column.total(matching)
                            : columnIndex === 0
                              ? totalLabel
                              : null}
                        </TableCell>
                      ))}
                      {rowActions ? (
                        <TableCell
                          className={cn(
                            STICKY_ACTIONS_CLASS,
                            'w-px bg-[color-mix(in_oklab,var(--color-muted)_50%,var(--color-card))]',
                          )}
                        />
                      ) : null}
                    </TableRow>
                  </TableFooter>
                ) : null}
              </table>
            </div>
          </>
        )}

        {!embedded && !showError && (hasRows || more?.hasMore) ? (
          <TableFooterBar
            label={label}
            page={page}
            onPage={setRequestedPage}
            more={more}
            pageSize={preferences.pageSize}
            onPageSize={(size) => {
              setPreferences({ pageSize: size });
              setRequestedPage(1);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

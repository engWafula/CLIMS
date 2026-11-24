'use client';

import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useRef, type ReactNode } from 'react';

import { FilterTabs } from '@/components/FilterTabs';
import { PageActions } from '@/components/PageActions';
import { PdfButton } from '@/components/reports/PdfButton';
import { Button } from '@/components/ui/button';
import { FilterBar } from '@/features/analytics/FilterBar';
import {
  apiParams,
  filterQuery,
  type ApiParam,
  type FilterField,
} from '@/features/analytics/filters';
import { useReportFilters, type ReportFilters } from '@/features/analytics/useReportFilters';
import { BatchesView, ExceptionsView } from '@/features/analytics/views/BatchesView';
import { HmisView } from '@/features/analytics/views/HmisView';
import { HotspotsView } from '@/features/analytics/views/HotspotsView';
import { NotificationsView } from '@/features/analytics/views/NotificationsView';
import { OverviewView } from '@/features/analytics/views/OverviewView';
import { StockView } from '@/features/analytics/views/StockView';
import { SupplyView } from '@/features/analytics/views/SupplyView';
import { useCan } from '@/features/auth/queries';
import { useCurrentWarehouse } from '@/features/warehouse/orderQueries';
import { StoreSwitch } from '@/features/warehouse/StoreSwitch';

import { queryString, type ReportKind, type ReportTable } from './api';
import { printCell } from './files';
import { useReportTable } from './queries';
import { DownloadButtons, ReportMeta, ReportTableView } from './ReportTableView';
import { ApproveVersionButton, VersionsView } from './VersionsView';

export type ReportsWorkspace = 'moh' | 'dcfp' | 'warehouse';
type View = 'overview' | ReportKind | 'hotspots' | 'versions';

/** The reports each workspace works with. */
const VIEWS: Record<ReportsWorkspace, readonly View[]> = {
  moh: [
    'overview',
    'notifications',
    'warehouse-requests',
    'stock',
    'batches',
    'expiry-exceptions',
    'hotspots',
    'hmis-105',
    'versions',
  ],
  dcfp: [
    'overview',
    'notifications',
    'warehouse-requests',
    'stock',
    'batches',
    'expiry-exceptions',
    'hotspots',
    'hmis-105',
    'versions',
  ],
  warehouse: [
    'overview',
    'warehouse-requests',
    'stock',
    'batches',
    'expiry-exceptions',
    'versions',
  ],
};

const VIEW_LABELS: Record<View, string> = {
  overview: 'Overview',
  notifications: 'Stockout requests',
  'warehouse-requests': 'Warehouse orders',
  stock: 'Stock & coverage',
  batches: 'Expiry risk',
  'expiry-exceptions': 'Expiry exceptions',
  hotspots: 'Hotspot coverage',
  'hmis-105': 'HMIS 105',
  versions: 'Approved versions',
};

/** What each report is, for the PDF's subtitle. */
const VIEW_PURPOSE: Record<Exclude<View, 'versions'>, string> = {
  overview: 'The programme at a glance: requests, orders, stock, expiry and hotspots.',
  notifications:
    'Hotspot stockout requests and how completely and quickly districts supplied them.',
  'warehouse-requests': 'District orders to the national warehouses, from request to receipt.',
  stock: 'Stock held at warehouses and district stores, and how long it lasts.',
  batches: 'Batches in stock by the time left before they expire.',
  'expiry-exceptions': 'Stock that left a store with under a month of shelf life, and why.',
  hotspots: 'Where the pick points are, whether they are active, and their dispensers.',
  'hmis-105': 'HMIS 105 condom figures prepared from acknowledged receipts.',
};

/** The filters each report reads; district is left to the server for district accounts. */
function fieldsFor(view: Exclude<View, 'versions'>, workspace: ReportsWorkspace): FilterField[] {
  const district: FilterField[] = workspace === 'dcfp' ? [] : ['district'];
  switch (view) {
    case 'overview':
      return [
        'period',
        'interval',
        ...district,
        'category',
        ...(workspace === 'moh' ? (['region'] as const) : []),
      ];
    case 'notifications':
      return ['period', 'interval', ...district, 'category', 'status'];
    case 'warehouse-requests':
      return [
        'period',
        'interval',
        ...district,
        ...(workspace === 'warehouse' ? [] : (['warehouse'] as const)),
        'category',
      ];
    case 'stock':
      return [...district, 'category', ...(workspace === 'moh' ? (['storeType'] as const) : [])];
    case 'batches':
      return [
        ...district,
        'category',
        'band',
        ...(workspace === 'moh' ? (['storeType'] as const) : []),
      ];
    case 'expiry-exceptions':
      return ['period', ...district, 'category'];
    case 'hotspots':
      return workspace === 'moh' ? ['region', 'district'] : [];
    case 'hmis-105':
      return ['month', ...district];
  }
}

/** The server export behind each report's table, with the parameters it reads. */
const EXPORT_PARAMS: Partial<Record<View, readonly ApiParam[]>> = {
  notifications: ['from', 'to', 'district_id', 'category', 'status'],
  'warehouse-requests': ['from', 'to', 'district_id', 'category', 'warehouse_store_id'],
  stock: ['district_id', 'category', 'store_type'],
  batches: ['district_id', 'category', 'store_type', 'band'],
  'expiry-exceptions': ['from', 'to', 'district_id', 'category', 'store_type'],
  'hmis-105': ['month', 'district_id'],
};

/** A PDF prints this many table rows at most; the CSV and Excel files hold them all. */
const PDF_ROWS = 300;

export function reportPath(workspace: ReportsWorkspace) {
  return `/${workspace}/programme-reports`;
}

export default function ProgrammeReportsPage({ workspace }: { workspace: ReportsWorkspace }) {
  const searchParams = useSearchParams();
  const filters = useReportFilters();
  const base = reportPath(workspace);
  const views = VIEWS[workspace];
  const view = views.find((entry) => entry === searchParams.get('view')) ?? views[0] ?? 'overview';
  const warehouse = useCurrentWarehouse({ enabled: workspace === 'warehouse' });
  const storeId = workspace === 'warehouse' ? warehouse.warehouse?.id : undefined;
  const store = searchParams.get('store') ?? '';

  return (
    <div className="gap-section flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterTabs
          label="Choose a report"
          value={view}
          tabs={views.map((value) => ({ value, label: VIEW_LABELS[value] }))}
          hrefFor={(value) => `${base}${filterQuery(filters.state, { view: value, store })}`}
        />
        {workspace === 'warehouse' ? (
          <StoreSwitch
            store={warehouse.code}
            hrefFor={(other) => `${base}${filterQuery(filters.state, { view, store: other })}`}
          />
        ) : null}
      </div>
      {view === 'versions' ? (
        <VersionsView
          selected={searchParams.get('version')}
          hrefFor={(id) => `${base}${queryString({ view: 'versions', version: id ?? '' })}`}
        />
      ) : workspace === 'warehouse' && !storeId ? null : (
        <ReportView
          key={view}
          view={view}
          workspace={workspace}
          filters={filters}
          storeId={storeId}
        />
      )}
    </div>
  );
}

interface ReportViewProps {
  view: Exclude<View, 'versions'>;
  workspace: ReportsWorkspace;
  filters: ReportFilters;
  storeId: string | undefined;
}

function ReportView({ view, workspace, filters, storeId }: ReportViewProps) {
  const can = useCan();
  const queryClient = useQueryClient();
  const contentRef = useRef<HTMLDivElement>(null);
  const exportKeys = EXPORT_PARAMS[view];
  const tableFilters = exportKeys
    ? {
        ...apiParams(filters.state, exportKeys),
        ...(storeId
          ? view === 'warehouse-requests'
            ? { warehouse_store_id: storeId }
            : { store_id: storeId }
          : {}),
      }
    : null;
  const fields = fieldsFor(view, workspace);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['analytics'] });
    void queryClient.invalidateQueries({ queryKey: ['programme-reports', 'table'] });
  };
  const fetching = queryClient.isFetching({ queryKey: ['analytics'] }) > 0;

  let visuals: ReactNode;
  switch (view) {
    case 'overview':
      visuals = <OverviewView filters={filters} workspace={workspace} storeId={storeId} />;
      break;
    case 'notifications':
      visuals = <NotificationsView filters={filters} workspace={workspace} />;
      break;
    case 'warehouse-requests':
      visuals = <SupplyView filters={filters} workspace={workspace} storeId={storeId} />;
      break;
    case 'stock':
      visuals = <StockView filters={filters} workspace={workspace} storeId={storeId} />;
      break;
    case 'batches':
      visuals = <BatchesView filters={filters} storeId={storeId} />;
      break;
    case 'expiry-exceptions':
      visuals = <ExceptionsView filters={filters} storeId={storeId} />;
      break;
    case 'hotspots':
      visuals = <HotspotsView filters={filters} workspace={workspace} />;
      break;
    case 'hmis-105':
      visuals = <HmisView filters={filters} />;
      break;
  }

  return (
    <div className="gap-section flex flex-col">
      {fields.length > 0 ? (
        <FilterBar filters={filters} fields={fields} inline={inlineFor(fields)} />
      ) : null}
      {tableFilters ? (
        <ExportedReport
          report={view as ReportKind}
          filters={tableFilters}
          title={VIEW_LABELS[view]}
          purpose={VIEW_PURPOSE[view]}
          contentRef={contentRef}
          canApprove={can('reports:approve')}
          onRefresh={refresh}
          fetching={fetching}
        >
          {visuals}
        </ExportedReport>
      ) : (
        <>
          <PageActions>
            <Button variant="ghost" onClick={refresh} disabled={fetching}>
              <RefreshCw
                data-icon="inline-start"
                className={fetching ? 'animate-spin' : undefined}
              />
              Refresh
            </Button>
            <PdfButton
              title={VIEW_LABELS[view]}
              subtitle={VIEW_PURPOSE[view]}
              targetRef={contentRef}
            />
          </PageActions>
          <div ref={contentRef} className="gap-section flex flex-col">
            {visuals}
          </div>
        </>
      )}
    </div>
  );
}

/** The bar shows the period and up to two more slicers; the rest wait in the pane. */
function inlineFor(fields: readonly FilterField[]): FilterField[] {
  const order: FilterField[] = [
    'period',
    'month',
    'district',
    'category',
    'warehouse',
    'band',
    'status',
    'region',
  ];
  return order.filter((field) => fields.includes(field)).slice(0, 3);
}

interface ExportedReportProps {
  report: ReportKind;
  filters: Record<string, string>;
  title: string;
  purpose: string;
  contentRef: React.RefObject<HTMLDivElement | null>;
  canApprove: boolean;
  onRefresh: () => void;
  fetching: boolean;
  children: ReactNode;
}

/** A report with a server export: the visuals, then the export's table, with CSV, Excel, PDF and approval. */
function ExportedReport({
  report,
  filters,
  title,
  purpose,
  contentRef,
  canApprove,
  onRefresh,
  fetching,
  children,
}: ExportedReportProps) {
  const table = useReportTable(report, filters);
  return (
    <>
      <PageActions>
        <Button
          variant="ghost"
          onClick={() => {
            onRefresh();
          }}
          disabled={fetching || table.isFetching}
        >
          <RefreshCw
            data-icon="inline-start"
            className={fetching || table.isFetching ? 'animate-spin' : undefined}
          />
          Refresh
        </Button>
        <PdfButton
          title={title}
          subtitle={purpose}
          targetRef={contentRef}
          meta={table.data ? pdfMeta(table.data) : []}
          tables={() => (table.data ? [pdfTable(table.data)] : [])}
          notes={table.data?.definitions ?? []}
        />
        <DownloadButtons
          table={table.data}
          csvPath={`/reports/export/${report}${queryString(filters, { format: 'csv' })}`}
        />
        {canApprove ? (
          <ApproveVersionButton report={report} filters={filters} table={table.data} />
        ) : null}
      </PageActions>
      <div ref={contentRef} className="gap-section flex flex-col">
        {children}
      </div>
      <section className="flex flex-col gap-3" aria-labelledby="report-records">
        <div>
          <h2 id="report-records" className="text-base font-semibold">
            Records
          </h2>
          <p className="text-muted-foreground text-sm">
            The rows behind the figures, exactly as the CSV and Excel downloads carry them.
          </p>
        </div>
        {table.data ? <ReportMeta table={table.data} /> : null}
        <ReportTableView
          table={table.data}
          isLoading={table.isPending}
          error={table.error}
          onRetry={() => void table.refetch()}
          isRetrying={table.isRefetching}
        />
      </section>
    </>
  );
}

function pdfMeta(table: ReportTable): [string, string][] {
  return [
    ['Scope', table.scope],
    ['Product', table.product],
    ['Data as of', printCell('data_updated_at', table.data_updated_at)],
    ['Rule version', table.rule_version],
  ];
}

function pdfTable(table: ReportTable) {
  const rows = table.rows.slice(0, PDF_ROWS);
  // Record IDs fill a printed page without telling a reader anything; the CSV keeps them.
  const columns = table.columns.filter(
    (column) => !column.header.endsWith(' ID') && column.key !== 'id',
  );
  return {
    title:
      table.rows.length > PDF_ROWS
        ? `Records (first ${PDF_ROWS} of ${table.rows.length}; the CSV holds them all)`
        : `Records (${table.rows.length})`,
    columns: columns.map((column) => column.header),
    rows: rows.map((row) => columns.map(({ key }) => printCell(key, row[key] ?? null))),
  };
}

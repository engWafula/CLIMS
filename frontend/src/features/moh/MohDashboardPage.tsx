'use client';

import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useRef } from 'react';

import { PageActions } from '@/components/PageActions';
import { PdfButton } from '@/components/reports/PdfButton';
import { TaskList, type TaskItem } from '@/components/TaskList';
import { hoursLabel } from '@/components/charts/format';
import { Button } from '@/components/ui/button';
import { FilterBar } from '@/features/analytics/FilterBar';
import { apiParams, filterQuery, type FilterField } from '@/features/analytics/filters';
import {
  useBatchReport,
  useNotificationReport,
  useStockReport,
  useSupplyReport,
} from '@/features/analytics/queries';
import { useReportFilters, type ReportFilters } from '@/features/analytics/useReportFilters';
import { OverviewView } from '@/features/analytics/views/OverviewView';
import { MIN_MONTHS } from '@/features/analytics/views/shared';
import { formatNumber } from '@/lib/format';

const FIELDS: readonly FilterField[] = ['period', 'interval', 'region', 'district', 'category'];
const REPORTS = '/moh/programme-reports';

/**
 * The national view for the Ministry of Health, which oversees the whole
 * programme and changes nothing: what needs watching, then the programme at a
 * glance (requests, warehouse orders, stock, expiry and hotspots) for the period
 * and place chosen, with a PDF of it all.
 */
export default function MohDashboardPage() {
  const filters = useReportFilters();
  const queryClient = useQueryClient();
  const contentRef = useRef<HTMLDivElement>(null);
  const fetching = queryClient.isFetching({ queryKey: ['analytics'] }) > 0;

  return (
    <div className="gap-section flex flex-col">
      <PageActions>
        <Button
          variant="ghost"
          onClick={() => void queryClient.invalidateQueries({ queryKey: ['analytics'] })}
          disabled={fetching}
        >
          <RefreshCw data-icon="inline-start" className={fetching ? 'animate-spin' : undefined} />
          Refresh
        </Button>
        <PdfButton
          title="MOH dashboard"
          subtitle="National view of condom stock, hotspot stockout requests, warehouse orders and deliveries."
          targetRef={contentRef}
        />
      </PageActions>
      <FilterBar filters={filters} fields={FIELDS} />
      <div ref={contentRef} className="gap-section flex flex-col">
        <WatchList filters={filters} />
        <OverviewView filters={filters} workspace="moh" />
      </div>
    </div>
  );
}

/**
 * What MOH should look into, from the same reports: requests past their
 * deadline, deliveries nobody acknowledged, stock that is expiring or short,
 * and ledgers that do not add up. Each opens the report behind it.
 */
function WatchList({ filters }: { filters: ReportFilters }) {
  const { state } = filters;
  const notifications = useNotificationReport(
    apiParams(state, ['from', 'to', 'district_id', 'category']),
  );
  const supply = useSupplyReport(apiParams(state, ['from', 'to', 'district_id', 'category']));
  const stockParams = apiParams(state, ['district_id', 'category']);
  const stock = useStockReport(stockParams);
  const batches = useBatchReport(stockParams);
  const queries = [notifications, supply, stock, batches];
  const failed = queries.find((query) => query.isError);
  const loading = queries.some((query) => query.isPending);
  const link = (view: string, extra: Record<string, string> = {}) =>
    `${REPORTS}${filterQuery(state, { view, ...extra })}`;

  let tasks: TaskItem[] | undefined;
  if (notifications.data && supply.data && stock.data && batches.data) {
    tasks = [];
    const n = notifications.data;
    if (n.deadline.late_pending > 0)
      tasks.push({
        id: 'late',
        status: { label: 'Overdue', tone: 'negative' },
        title: `${formatNumber(n.deadline.late_pending)} stockout request${n.deadline.late_pending === 1 ? '' : 's'} past the ${n.deadline.days}-day deadline`,
        detail: 'Raised in the period and still waiting for the district to supply them.',
        action: 'See requests',
        href: link('notifications', { status: 'awaiting_supply' }),
      });
    if (n.acknowledgement_overdue > 0)
      tasks.push({
        id: 'ack',
        status: { label: 'Quality issue', tone: 'caution' },
        title: `${formatNumber(n.acknowledgement_overdue)} deliver${n.acknowledgement_overdue === 1 ? 'y' : 'ies'} not acknowledged in time`,
        detail:
          'The hotspot manager has not confirmed what arrived; they do not count as fulfilled.',
        action: 'See requests',
        href: link('notifications', { status: 'awaiting_acknowledgement' }),
      });
    if (n.backlog.open > 0)
      tasks.push({
        id: 'backlog',
        status: { label: 'Backlog', tone: 'caution' },
        title: `${formatNumber(n.backlog.open)} request${n.backlog.open === 1 ? '' : 's'} open from before the period`,
        detail: 'Kept apart from the period figures; they are still waiting.',
        action: 'See requests',
        href: link('notifications'),
      });
    const pending = supply.data.total.pending;
    if (pending > 0)
      tasks.push({
        id: 'orders',
        status: { label: 'Open', tone: 'info' },
        title: `${formatNumber(pending)} district order${pending === 1 ? '' : 's'} to the warehouses not received yet`,
        detail: supply.data.response.oldest_pending_hours
          ? `The oldest has waited ${hoursLabel(supply.data.response.oldest_pending_hours)}.`
          : 'Raised in the period and not yet counted in by the district.',
        action: 'See orders',
        href: link('warehouse-requests'),
      });
    const expired = batches.data.lines.filter((line) => line.band === 'expired');
    const expiring = batches.data.lines.filter((line) => line.band === 'under_1_month');
    if (expired.length > 0)
      tasks.push({
        id: 'expired',
        status: { label: 'Expired', tone: 'negative' },
        title: `${formatNumber(expired.reduce((sum, line) => sum + (line.pieces ?? 0), 0))} expired pieces still on hand`,
        detail: `${formatNumber(expired.length)} batch${expired.length === 1 ? '' : 'es'} to separate and dispose of.`,
        action: 'See batches',
        href: link('batches', { band: 'expired' }),
      });
    if (expiring.length > 0)
      tasks.push({
        id: 'expiring',
        status: { label: 'Expiring', tone: 'caution' },
        title: `${formatNumber(expiring.reduce((sum, line) => sum + (line.pieces ?? 0), 0))} pieces expire within a month`,
        detail: `${[...new Set(expiring.map((line) => line.store))].join(', ')}: issue them first or plan redistribution.`,
        action: 'See batches',
        href: link('batches', { band: 'under_1_month' }),
      });
    const low = stock.data.lines.filter(
      (line) => line.months_of_stock !== null && line.months_of_stock < MIN_MONTHS,
    );
    if (low.length > 0)
      tasks.push({
        id: 'low',
        status: { label: 'Low stock', tone: 'caution' },
        title: `${formatNumber(low.length)} stock line${low.length === 1 ? '' : 's'} below ${MIN_MONTHS} months of stock`,
        detail: `${[...new Set(low.map((line) => line.store))].slice(0, 4).join(', ')}${low.length > 4 ? ' and others' : ''}.`,
        action: 'See stock',
        href: link('stock'),
      });
    const unreconciled = stock.data.lines.filter(
      (line) => !line.reconciled || !line.batches_reconciled,
    );
    if (unreconciled.length > 0)
      tasks.push({
        id: 'reconcile',
        status: { label: 'Check ledger', tone: 'caution' },
        title: `${formatNumber(unreconciled.length)} stock line${unreconciled.length === 1 ? '' : 's'} do not reconcile`,
        detail: 'The ledger or batches do not add up to the physical balance.',
        action: 'See stock',
        href: link('stock'),
      });
  }

  return (
    <TaskList
      title="Needs watching"
      tasks={tasks}
      isLoading={loading && !failed}
      error={failed?.error}
      errorTitle="Could not check the programme's figures"
      onRetry={() => {
        for (const query of queries) void query.refetch();
      }}
      loadingLabel="Checking the programme's figures…"
      empty={{
        title: 'Nothing needs watching',
        description:
          'No overdue requests, expiring or short stock, or ledgers out of balance for these filters.',
      }}
    />
  );
}

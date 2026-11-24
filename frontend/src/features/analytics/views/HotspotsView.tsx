'use client';

import { Ban, Inbox, MapPin, MapPinCheck, MapPinned, Package } from 'lucide-react';

import { BarChart } from '@/components/charts/BarChart';
import { ColumnChart } from '@/components/charts/ColumnChart';
import { DataBar } from '@/components/charts/DataBar';
import { SegmentedBar } from '@/components/charts/SegmentedBar';
import { DataTable } from '@/components/data-table/DataTable';
import { StatCard, StatCardGrid } from '@/components/StatCard';
import { formatNumber } from '@/lib/format';

import type { HotspotGroup } from '../api';
import { apiParams } from '../filters';
import { useHotspotReport } from '../queries';
import type { ReportFilters } from '../useReportFilters';
import { QualityNote, ReportSection, VisualGrid, type AnalyticsWorkspace } from './shared';

const DISPENSER_COLORS: Record<string, { color: string; ink?: 'surface' }> = {
  Working: { color: 'var(--success)', ink: 'surface' },
  'Needs repair': { color: 'var(--warning)', ink: 'surface' },
  Empty: { color: 'var(--destructive)', ink: 'surface' },
  'Too few dispensers': { color: 'var(--info)', ink: 'surface' },
  'Not installed': { color: 'var(--chart-3)' },
  'Not recorded': { color: 'var(--role-system)' },
};

function percent(part: number, whole: number): string {
  return whole > 0 ? `${formatNumber(Math.round((part / whole) * 1000) / 10)}%` : '—';
}

function monthName(key: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(`${key}-01T00:00:00Z`));
}

/** Hotspot coverage: where the pick points are, whether they are active, and their dispensers. */
export function HotspotsView({
  filters,
  workspace,
}: {
  filters: ReportFilters;
  workspace: AnalyticsWorkspace;
}) {
  const report = useHotspotReport(apiParams(filters.state, ['region_id', 'district_id']));
  const data = report.data;
  const loading = report.isPending;
  const retry = () => void report.refetch();
  const total = data?.total;
  const split = (group: HotspotGroup) => ({
    label: group.name ?? 'Not recorded',
    values: { active: group.active, inactive: group.total - group.active },
  });
  const maxDistrict = Math.max(0, ...(data?.by_district ?? []).map((group) => group.total));

  return (
    <div className="gap-section flex flex-col">
      <StatCardGrid>
        <StatCard
          label="Hotspots recorded"
          value={formatNumber(total?.total)}
          icon={MapPin}
          isLoading={loading}
        />
        <StatCard
          label="Active"
          value={formatNumber(total?.active)}
          icon={MapPinCheck}
          accent="positive"
          isLoading={loading}
          detail={total ? `${percent(total.active, total.total)} of those recorded` : undefined}
        />
        <StatCard
          label="Deactivated or not approved"
          value={total ? formatNumber(total.deactivated + total.rejected + total.submitted) : ''}
          icon={Ban}
          accent="caution"
          isLoading={loading}
          detail={
            total
              ? `${formatNumber(total.submitted)} waiting for review · ${formatNumber(total.rejected)} rejected`
              : undefined
          }
        />
        <StatCard
          label="With a dispenser"
          value={formatNumber(total?.with_dispenser)}
          icon={Package}
          accent="violet"
          isLoading={loading}
          detail={total ? `${percent(total.with_dispenser, total.total)} of hotspots` : undefined}
        />
        <StatCard
          label="On the map"
          value={formatNumber(total?.located)}
          icon={MapPinned}
          accent="info"
          isLoading={loading}
          detail={
            total ? `${percent(total.located, total.total)} have a recorded position` : undefined
          }
        />
        <StatCard
          label="Waiting on stock"
          value={formatNumber(total?.open_requests)}
          icon={Inbox}
          accent="caution"
          isLoading={loading}
          detail="Hotspots with an open stockout request"
        />
      </StatCardGrid>

      <ReportSection title="Where hotspots are">
        <VisualGrid>
          {workspace === 'moh' ? (
            <BarChart
              title="By region"
              description="Hotspots recorded in each region, split by whether they are active."
              categoryLabel="Region"
              series={[
                { key: 'active', label: 'Active', color: 'var(--chart-1)' },
                { key: 'inactive', label: 'Not active', color: 'var(--chart-4)' },
              ]}
              rows={(data?.by_region ?? []).map(split)}
              limit={16}
              isLoading={loading}
              error={report.error}
              onRetry={retry}
              emptyMessage="No hotspots are recorded for these filters."
            />
          ) : null}
          <BarChart
            title="By district"
            description="The districts with the most hotspots recorded."
            categoryLabel="District"
            series={[
              { key: 'active', label: 'Active', color: 'var(--chart-1)' },
              { key: 'inactive', label: 'Not active', color: 'var(--chart-4)' },
            ]}
            rows={(data?.by_district ?? []).map(split)}
            isLoading={loading}
            error={report.error}
            onRetry={retry}
            emptyMessage="No hotspots are recorded for these filters."
          />
          <BarChart
            title="By venue type"
            description="The kind of pick point, sorted into the guidelines' venue types."
            categoryLabel="Venue type"
            series={{ key: 'total', label: 'Hotspots', color: 'var(--chart-3)' }}
            rows={(data?.by_type ?? []).map((group) => ({
              label: group.name ?? 'Not recorded',
              values: { total: group.total },
            }))}
            limit={12}
            isLoading={loading}
            error={report.error}
            onRetry={retry}
            emptyMessage="No hotspots are recorded for these filters."
            footer='"Not recorded" includes legacy records whose type holds "new" or "old" rather than a venue.'
          />
          <SegmentedBar
            title="Dispenser condition"
            description="Hotspots with a dispenser, by the condition recorded for it."
            totalLabel="Hotspots with a dispenser"
            segments={(data?.dispensers ?? []).map((group) => ({
              key: group.name ?? 'Not recorded',
              label: group.name ?? 'Not recorded',
              value: group.total,
              ...(DISPENSER_COLORS[group.name ?? 'Not recorded'] ?? {
                color: 'var(--role-system)',
              }),
            }))}
            isLoading={loading}
            error={report.error}
            onRetry={retry}
            emptyMessage="No hotspot reports a dispenser."
          />
        </VisualGrid>
      </ReportSection>

      <ReportSection
        title="Registrations"
        description="Hotspots recorded in CLIMS each month, over the last twelve months."
      >
        <ColumnChart
          title="Hotspots recorded per month"
          description="By the day the record was created; hotspots imported from the legacy system carry their import date."
          categoryLabel="Month"
          series={[
            { key: 'registered', label: 'Recorded', color: 'var(--chart-1)' },
            { key: 'activated', label: 'Of those, active now', color: 'var(--chart-2)' },
          ]}
          rows={
            data?.registrations.some((month) => month.registered > 0)
              ? data.registrations.map((month) => ({
                  label: monthName(month.month),
                  values: { registered: month.registered, activated: month.activated },
                }))
              : []
          }
          isLoading={loading}
          error={report.error}
          onRetry={retry}
          emptyMessage="No hotspots were recorded in the last twelve months."
        />
      </ReportSection>

      {data && data.by_district.length > 0 ? (
        <ReportSection
          title="Districts"
          description="Every district's hotspots, with data bars to compare them."
        >
          <div className="bg-card rounded-card overflow-hidden border">
            <DataTable
              label="Hotspots by district"
              rows={data.by_district}
              getRowId={(row) => row.id ?? 'none'}
              preferencesKey="analytics-hotspots-by-district"
              columns={[
                { id: 'district', header: 'District', value: (row) => row.name ?? 'Not recorded' },
                {
                  id: 'total',
                  header: 'Recorded',
                  numeric: true,
                  value: (row) => row.total,
                  cell: (row) => <DataBar value={row.total} max={maxDistrict} />,
                },
                {
                  id: 'active',
                  header: 'Active',
                  numeric: true,
                  value: (row) => row.active,
                  cell: (row) => formatNumber(row.active),
                },
                {
                  id: 'dispenser',
                  header: 'With dispenser',
                  numeric: true,
                  value: (row) => row.with_dispenser,
                  cell: (row) => formatNumber(row.with_dispenser),
                },
                {
                  id: 'located',
                  header: 'On the map',
                  numeric: true,
                  value: (row) => row.located,
                  cell: (row) => percent(row.located, row.total),
                },
                {
                  id: 'open',
                  header: 'Waiting on stock',
                  numeric: true,
                  value: (row) => row.open_requests,
                  cell: (row) => formatNumber(row.open_requests),
                },
              ]}
            />
          </div>
          <QualityNote>Hotspots without a district are listed as “Not recorded”.</QualityNote>
        </ReportSection>
      ) : null}
    </div>
  );
}

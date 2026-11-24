'use client';

import {
  BadgeCheck,
  Clock,
  History,
  Hourglass,
  Megaphone,
  PackageCheck,
  Timer,
} from 'lucide-react';

import { BarChart } from '@/components/charts/BarChart';
import { ColumnChart } from '@/components/charts/ColumnChart';
import { hoursLabel, percentLabel } from '@/components/charts/format';
import { GaugeChart } from '@/components/charts/GaugeChart';
import { SegmentedBar } from '@/components/charts/SegmentedBar';
import { TrendChart } from '@/components/charts/TrendChart';
import { StatCard, StatCardGrid } from '@/components/StatCard';
import { formatNumber, formatTimestamp } from '@/lib/format';

import { apiParams } from '../filters';
import { useNotificationReport, useTrends } from '../queries';
import type { ReportFilters } from '../useReportFilters';
import {
  INTERVAL_WORD,
  isFlat,
  percentOrNa,
  QualityNote,
  ReportSection,
  series,
  statusSegments,
  trendRows,
  VisualGrid,
  type AnalyticsWorkspace,
} from './shared';

const SETTINGS_SOURCE = {
  store: "the district store's own targets",
  national: 'the national targets',
  default: 'the draft defaults',
} as const;

/** Hotspot stockout requests: how many, how fast and how completely districts supplied them. */
export function NotificationsView({
  filters,
  workspace,
}: {
  filters: ReportFilters;
  workspace: AnalyticsWorkspace;
}) {
  const params = apiParams(filters.state, ['from', 'to', 'district_id', 'category']);
  const report = useNotificationReport(params);
  const trend = useTrends(
    apiParams(filters.state, ['from', 'to', 'interval', 'district_id', 'category']),
  );
  const data = report.data;
  const loading = report.isPending;
  const caption = `vs ${INTERVAL_WORD[trend.data?.interval ?? filters.interval]}`;
  const retry = () => void report.refetch();

  const raisedRows = trendRows(trend.data, (b) => ({
    raised: b.notifications.raised,
    fulfilled: b.notifications.fulfilled,
  }));
  const responseRows = trendRows(trend.data, (b) => ({
    hours: b.notifications.median_response_hours,
  }));
  const selection = data?.by_selection ?? {};
  const selectionRows =
    data && data.notifications_raised > 0
      ? [
          { label: 'Male', values: { count: selection.male ?? 0 } },
          { label: 'Female', values: { count: selection.female ?? 0 } },
          { label: 'Both', values: { count: selection.both ?? 0 } },
        ]
      : [];
  const districts = data?.districts ?? [];

  return (
    <div className="gap-section flex flex-col">
      <StatCardGrid>
        <StatCard
          label="Requests raised"
          value={formatNumber(data?.notifications_raised)}
          icon={Megaphone}
          accent="info"
          isLoading={loading}
          trend={
            trend.data && trend.data.buckets.length > 1
              ? { series: series(trend.data, (b) => b.notifications.raised), caption }
              : undefined
          }
        />
        <StatCard
          label="Fulfilled"
          value={formatNumber(data?.notifications_fulfilled)}
          icon={BadgeCheck}
          accent="positive"
          isLoading={loading}
          detail={
            data
              ? `${formatNumber(data.notifications_rejected)} rejected by the district`
              : undefined
          }
        />
        <StatCard
          label="Fulfilment rate"
          value={data ? percentOrNa(data.fulfilment_rate) : ''}
          icon={PackageCheck}
          accent="violet"
          isLoading={loading}
          detail="Fully acknowledged by the hotspot, of those raised"
        />
        <StatCard
          label="Median time to fulfil"
          value={
            data
              ? data.response.median_hours === null
                ? 'Not applicable'
                : hoursLabel(data.response.median_hours)
              : ''
          }
          icon={Timer}
          isLoading={loading}
          detail={
            data && data.response.oldest_pending_hours !== null
              ? `Oldest open: ${hoursLabel(data.response.oldest_pending_hours)}`
              : undefined
          }
        />
        <StatCard
          label="Past the deadline, still open"
          value={formatNumber(data?.deadline.late_pending)}
          icon={Hourglass}
          accent="caution"
          isLoading={loading}
          detail={data ? `Deadline ${data.deadline.days} days` : undefined}
        />
        <StatCard
          label="Open from before the period"
          value={formatNumber(data?.backlog.open)}
          icon={History}
          accent="caution"
          isLoading={loading}
          detail={
            data?.backlog.oldest_raised_at
              ? `Oldest raised ${formatTimestamp(data.backlog.oldest_raised_at)}`
              : 'Backlog, kept apart from the period'
          }
        />
      </StatCardGrid>

      {data ? (
        <QualityNote>
          Acknowledgements recorded through {formatTimestamp(data.acknowledgements_through)}.
          Targets: {data.settings.review_cycle} review, {data.settings.deadline_days}-day deadline,{' '}
          {data.settings.target_percent}% on time, from {SETTINGS_SOURCE[data.settings.source]}.
          {data.acknowledgement_overdue > 0
            ? ` Quality issue: ${formatNumber(data.acknowledgement_overdue)} with a delivery not acknowledged within the deadline.`
            : ''}
        </QualityNote>
      ) : null}

      <ReportSection
        title="Performance"
        description="Requests raised in the period against the on-time target."
      >
        <VisualGrid columns={3}>
          <GaugeChart
            title="On time"
            description={
              data
                ? `Fulfilled within ${data.deadline.days} days, of requests raised.`
                : 'Fulfilled within the deadline.'
            }
            measure="On time"
            value={data?.deadline.on_time_rate ?? null}
            target={data?.deadline.target_percent ?? 80}
            caption={
              data
                ? `${formatNumber(data.deadline.fulfilled_on_time)} of ${formatNumber(data.notifications_raised)} requests`
                : undefined
            }
            isLoading={loading}
            error={report.error}
            onRetry={retry}
          />
          <SegmentedBar
            title="Request status"
            description="Where each request raised in the period stands now."
            totalLabel="Requests raised"
            segments={data && data.notifications_raised > 0 ? statusSegments(data) : []}
            isLoading={loading}
            error={report.error}
            onRetry={retry}
            emptyMessage="No requests were raised in this period."
          />
          <ColumnChart
            title="Requests by condom type"
            description="What the hotspot asked for when it raised the request."
            categoryLabel="Type"
            series={{ key: 'count', label: 'Requests', color: 'var(--chart-3)' }}
            rows={selectionRows}
            isLoading={loading}
            error={report.error}
            onRetry={retry}
            emptyMessage="No requests were raised in this period."
          />
        </VisualGrid>
      </ReportSection>

      <ReportSection title="Over time" description="By the day each request was first raised.">
        <VisualGrid>
          <ColumnChart
            title="Raised and fulfilled"
            description="Requests raised per period, and how many of them are fulfilled now."
            categoryLabel="Period"
            series={[
              { key: 'raised', label: 'Raised', color: 'var(--chart-1)' },
              { key: 'fulfilled', label: 'Fulfilled', color: 'var(--chart-2)' },
            ]}
            rows={isFlat(raisedRows) ? [] : raisedRows}
            isLoading={trend.isPending}
            error={trend.error}
            onRetry={() => void trend.refetch()}
            emptyMessage="No requests were raised in this period."
          />
          <TrendChart
            title="Median time to fulfil"
            description="Hours from the request to the last acknowledged delivery, for requests fulfilled."
            categoryLabel="Period"
            kind="line"
            series={[{ key: 'hours', label: 'Median hours', color: 'var(--chart-4)' }]}
            rows={responseRows.some((row) => row.values.hours !== null) ? responseRows : []}
            valueFormat={hoursLabel}
            reference={
              data
                ? { value: data.deadline.days * 24, label: `Deadline ${data.deadline.days} days` }
                : undefined
            }
            isLoading={trend.isPending}
            error={trend.error}
            onRetry={() => void trend.refetch()}
            emptyMessage="No request raised in this period is fulfilled yet."
          />
        </VisualGrid>
      </ReportSection>

      {workspace === 'moh' || districts.length > 1 ? (
        <ReportSection title="By district" description="Compare districts on the same measures.">
          <VisualGrid>
            <BarChart
              title="Requests raised by district"
              description="Requests raised in the period."
              categoryLabel="District"
              series={{ key: 'raised', label: 'Requests raised', color: 'var(--chart-1)' }}
              rows={districts.map((row) => ({
                label: row.district ?? 'No district',
                values: { raised: row.notifications_raised },
              }))}
              isLoading={loading}
              error={report.error}
              onRetry={retry}
              emptyMessage="No district had requests in this period."
            />
            <BarChart
              title="Fulfilment rate by district"
              description="Fully acknowledged, of the requests raised in the period."
              categoryLabel="District"
              series={{ key: 'rate', label: 'Fulfilment rate', color: 'var(--chart-2)' }}
              rows={districts
                .filter((row) => row.fulfilment_rate !== null)
                .map((row) => ({
                  label: row.district ?? 'No district',
                  values: { rate: row.fulfilment_rate },
                }))}
              valueFormat={percentLabel}
              xMax={100}
              reference={
                data
                  ? {
                      value: data.deadline.target_percent,
                      label: `Target ${data.deadline.target_percent}%`,
                    }
                  : undefined
              }
              isLoading={loading}
              error={report.error}
              onRetry={retry}
              emptyMessage="No district had requests in this period."
            />
          </VisualGrid>
        </ReportSection>
      ) : null}

      {data ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Clock className="size-3.5" aria-hidden="true" />
          Period {data.period.from} to {data.period.to}; figures as of{' '}
          {formatTimestamp(data.data_updated_at)}.
        </p>
      ) : null}
    </div>
  );
}

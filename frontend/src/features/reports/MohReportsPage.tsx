'use client';

import { useDistrictContext } from '@/features/district/DistrictContext';
import { ClipboardList, Eye, Megaphone, Store, Users, Warehouse, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { RowActions } from '@/components/data-table/RowActions';
import { ExportButton } from '@/components/ExportButton';
import { FilterTabs } from '@/components/FilterTabs';
import { SelectField } from '@/components/form/SelectField';
import { PageActions } from '@/components/PageActions';
import { SampleDataNotice } from '@/components/SampleData';
import { StatCard, StatCardGrid } from '@/components/StatCard';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { PageSkeleton } from '@/components/states/PageSkeleton';
import { StatusBadge } from '@/components/StatusBadge';
import { getErrorMessage } from '@/lib/api';
import type { ExportColumn } from '@/lib/export/excel';
import { formatDate, formatNumber, formatTimestamp } from '@/lib/format';

import { REPORT_LEVELS, type MonthlyReport, type ReportLevel, type ReportPeriod } from './api';
import {
  usePeriodReports,
  useRemindReporter,
  useReportCoverage,
  useReportPeriods,
} from './queries';
import {
  LEVEL_LABELS,
  LEVEL_PLURALS,
  mohStatus,
  periodLabel,
  progressText,
  REPORT_PATHS,
} from './status';

const LIST_PATH = REPORT_PATHS.list('moh');

/** `type` in the address: one level, or every level. */
type TypeFilter = 'all' | ReportLevel;
/** `status` in the address: reports MOH has received, or those still with the reporter. */
type StatusFilter = 'submitted' | 'not_sent';

const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'submitted', label: 'Received' },
  { value: 'not_sent', label: 'Not sent' },
];

const LEVEL_ICONS = { hotspot: MapPin, vht: Users, district: Store, warehouse: Warehouse } as const;

function typeFrom(param: string | null): TypeFilter {
  return REPORT_LEVELS.find((level) => level === param) ?? 'all';
}

function statusFrom(param: string | null): StatusFilter {
  return param === 'not_sent' ? 'not_sent' : 'submitted';
}

interface Filters {
  month: string;
  type: TypeFilter;
  status: StatusFilter;
}

/** The list's address for a set of filters. Defaults are left out to keep it short. */
export function submissionsHref({ month, type, status }: Filters): string {
  const query = new URLSearchParams({ month });
  if (type !== 'all') query.set('type', type);
  if (status !== 'submitted') query.set('status', status);
  return `${LIST_PATH}?${query.toString()}`;
}

const keeps = (filters: Omit<Filters, 'month'>) => (report: MonthlyReport) =>
  (filters.type === 'all' || report.level === filters.type) &&
  (filters.status === 'submitted') === (report.status === 'submitted');

/** Every unit's monthly report for one month: who has sent it, and who has not. */
export default function MohReportsPage() {
  const periods = useReportPeriods();
  const searchParams = useSearchParams();

  if (periods.isPending) return <PageSkeleton layout="table" />;
  if (periods.isError) {
    return (
      <div className="bg-card rounded-card border">
        <ErrorState
          title="Could not load the reporting months"
          error={periods.error}
          onRetry={() => void periods.refetch()}
          isRetrying={periods.isRefetching}
        />
      </div>
    );
  }
  const [newest] = periods.data;
  if (!newest) {
    return (
      <div className="gap-section flex flex-col">
        <SampleDataNotice subject="The reports" />
        <div className="bg-card rounded-card border">
          <EmptyState
            icon={ClipboardList}
            title="No reporting months yet"
            description="Reports appear here once the first month closes and units start sending them."
          />
        </div>
      </div>
    );
  }

  const month = searchParams.get('month');
  const period = periods.data.find((candidate) => candidate.period === month) ?? newest;
  return (
    <Submissions
      periods={periods.data}
      period={period}
      type={typeFrom(searchParams.get('type'))}
      status={statusFrom(searchParams.get('status'))}
    />
  );
}

interface SubmissionsProps {
  periods: readonly ReportPeriod[];
  period: ReportPeriod;
  type: TypeFilter;
  status: StatusFilter;
}

function Submissions({ periods, period, type, status }: SubmissionsProps) {
  const router = useRouter();
  const reports = usePeriodReports(period.period);
  const coverage = useReportCoverage(period.period);
  const remind = useRemindReporter();
  const month = period.period;

  const columns = useMemo<DataTableColumn<MonthlyReport>[]>(
    () => [
      {
        id: 'unit',
        filter: 'select',
        header: 'Reporting unit',
        value: (report) => report.unit.name,
        cell: (report) => (
          <div className="min-w-0">
            {report.status === 'submitted' ? (
              <Link
                href={REPORT_PATHS.report('moh', report.id)}
                className={`underline-offset-4 hover:underline ${report.reviewed_at === null ? 'font-semibold' : 'font-medium'}`}
              >
                {report.unit.name}
              </Link>
            ) : (
              <span className="font-medium">{report.unit.name}</span>
            )}
            <div className="text-muted-foreground text-xs">{report.id}</div>
          </div>
        ),
      },
      {
        id: 'level',
        filter: 'select',
        header: 'Level',
        value: (report) => LEVEL_LABELS[report.level],
        cell: (report) => (
          <div className="min-w-0">
            <div>{LEVEL_LABELS[report.level]}</div>
            <div className="text-muted-foreground text-xs">
              {report.level === 'warehouse' || !report.unit.district
                ? 'National'
                : `${report.unit.district} district`}
            </div>
          </div>
        ),
      },
      { id: 'reporter', header: 'Reported by', value: (report) => report.reporter },
      {
        id: 'sent',
        filter: 'date',
        header: 'Sent',
        value: (report) => report.submitted_at ?? '',
        cell: (report) => formatTimestamp(report.submitted_at),
      },
      {
        id: 'validation',
        filter: 'select',
        header: 'Validation',
        value: (report) => progressText(report),
        cell: (report) => (
          <span className={report.status === 'errors' ? 'text-destructive' : undefined}>
            {progressText(report)}
          </span>
        ),
      },
      {
        id: 'status',
        filter: 'select',
        header: 'Status',
        value: (report) => mohStatus(report).label,
        cell: (report) => {
          const shown = mohStatus(report);
          return <StatusBadge status={shown.label} tone={shown.tone} />;
        },
      },
    ],
    [],
  );

  const district = useDistrictContext()?.district;
  const all = (reports.data ?? []).filter(
    (report) => !district || report.unit.district === district,
  );
  const rows = reports.data
    ? all
        .filter(keeps({ type, status }))
        .sort((a, b) =>
          status === 'submitted'
            ? (b.submitted_at ?? '').localeCompare(a.submitted_at ?? '')
            : a.unit.name.localeCompare(b.unit.name),
        )
    : undefined;
  const countOf = (filters: Omit<Filters, 'month'>) =>
    reports.data ? all.filter(keeps(filters)).length : undefined;

  const exportColumns: ExportColumn<MonthlyReport>[] = [
    { header: 'Report', value: (report) => report.id },
    { header: 'Reporting unit', value: (report) => report.unit.name },
    { header: 'Level', value: (report) => LEVEL_LABELS[report.level] },
    { header: 'District', value: (report) => report.unit.district ?? 'National' },
    { header: 'Reported by', value: (report) => report.reporter },
    { header: 'Sent', value: (report) => report.submitted_at ?? '' },
    { header: 'Validation', value: (report) => progressText(report) },
    { header: 'Status', value: (report) => mohStatus(report).label },
  ];

  return (
    <div className="gap-section flex flex-col">
      <PageActions>
        <ExportButton name={`Monthly reports ${month}`} columns={exportColumns} rows={rows} />
      </PageActions>
      <SampleDataNotice subject="The reports and reporting rates" />

      {district ? null : coverage.isError ? (
        <p className="text-destructive text-sm" role="alert">
          Could not load how many units have reported: {getErrorMessage(coverage.error)}
        </p>
      ) : (
        <StatCardGrid>
          {(
            coverage.data ?? REPORT_LEVELS.map((level) => ({ level, expected: 0, submitted: 0 }))
          ).map((entry) => {
            const percent =
              entry.expected > 0 ? Math.round((entry.submitted / entry.expected) * 100) : 0;
            return (
              <StatCard
                key={entry.level}
                label={`${LEVEL_PLURALS[entry.level]} reported: ${formatNumber(entry.submitted)} of ${formatNumber(entry.expected)}`}
                value={`${percent}%`}
                icon={LEVEL_ICONS[entry.level]}
                accent={entry.level === type ? 'positive' : 'neutral'}
                href={submissionsHref({ month, type: entry.level, status })}
                isLoading={coverage.isPending}
              />
            );
          })}
        </StatCardGrid>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="w-full sm:w-56">
          <SelectField
            label="Reporting month"
            required
            value={month}
            onValueChange={(value) => {
              router.replace(submissionsHref({ month: value, type, status }));
            }}
            options={periods.map((candidate) => ({
              value: candidate.period,
              label: periodLabel(candidate.period),
            }))}
            placeholder="Choose a month"
            description={`Due ${formatDate(period.due_on)}`}
          />
        </div>
        <FilterTabs
          label="Filter reports by level"
          value={type}
          hrefFor={(value) => submissionsHref({ month, type: value, status })}
          tabs={[
            { value: 'all' as const, label: 'All levels', count: countOf({ type: 'all', status }) },
            ...REPORT_LEVELS.map((level) => ({
              value: level,
              label: LEVEL_PLURALS[level],
              count: countOf({ type: level, status }),
            })),
          ]}
        />
        <FilterTabs
          label="Filter reports by status"
          value={status}
          hrefFor={(value) => submissionsHref({ month, type, status: value })}
          tabs={STATUS_FILTERS.map((filter) => ({
            ...filter,
            count: countOf({ type, status: filter.value }),
          }))}
        />
      </div>

      <DataTable
        label={`Monthly reports, ${periodLabel(month)}`}
        preferencesKey="moh-monthly-reports"
        columns={columns}
        rows={rows}
        getRowId={(report) => report.id}
        isLoading={reports.isPending}
        error={reports.error}
        onRetry={() => void reports.refetch()}
        isRetrying={reports.isRefetching}
        searchPlaceholder="Search reporting units…"
        emptyTitle="No reports match these filters"
        emptyDescription={
          status === 'submitted'
            ? `Nothing received for ${periodLabel(month)} at this level yet.`
            : 'Every unit at this level has sent its report.'
        }
        rowActions={(report) => (
          <RowActions
            label={`Actions for ${report.unit.name}`}
            actions={[
              report.status === 'submitted'
                ? {
                    label: 'View report',
                    icon: Eye,
                    onSelect: () => {
                      router.push(REPORT_PATHS.report('moh', report.id));
                    },
                  }
                : {
                    label: `Remind ${report.reporter}`,
                    icon: Megaphone,
                    onSelect: () => {
                      remind.mutate(report);
                    },
                  },
            ]}
          />
        )}
      />
    </div>
  );
}

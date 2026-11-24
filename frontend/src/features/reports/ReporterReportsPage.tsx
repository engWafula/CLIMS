'use client';

import { ArrowRight, ClipboardList, Eye, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { RowActions } from '@/components/data-table/RowActions';
import { DetailHeader } from '@/components/DetailHeader';
import { SelectField } from '@/components/form/SelectField';
import { SampleDataNotice } from '@/components/SampleData';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { PageSkeleton } from '@/components/states/PageSkeleton';
import { StatusBadge } from '@/components/StatusBadge';
import { StepTracker } from '@/components/StepTracker';
import { Button } from '@/components/ui/button';
import { formatDate, formatTimestamp } from '@/lib/format';

import type { MonthlyReport, ReporterLevel } from './api';
import { REPORT_FORMS } from './figures';
import { useOwnReports } from './queries';
import { prefilledLine, reportTitle } from './ReportParts';
import { periodLabel, REPORT_PATHS, reporterStatus, reportSteps, validationText } from './status';

interface ReporterReportsPageProps {
  workspace: 'dcfp' | 'warehouse';
  level: ReporterLevel;
  /** For a warehouse: which national warehouse's reports, e.g. `NMS`. */
  store?: string;
  /** Adds what the workspace keeps in its links (the warehouse's `?store=`) to a path. */
  linkTo?: (path: string) => string;
}

const asIs = (path: string) => path;

/** The month's report and what to do about it, then every report the unit has sent. */
export default function ReporterReportsPage({
  workspace,
  level,
  store,
  linkTo = asIs,
}: ReporterReportsPageProps) {
  const reports = useOwnReports(store ? { level, store } : { level });
  const router = useRouter();
  const searchParams = useSearchParams();
  const month = searchParams.get('month');
  const listPath = REPORT_PATHS.list(workspace);

  const columns = useMemo<DataTableColumn<MonthlyReport>[]>(
    () => [
      {
        id: 'period',
        header: 'Period',
        value: (report) => report.period,
        cell: (report) => (
          <div className="min-w-0">
            <Link
              href={linkTo(REPORT_PATHS.report(workspace, report.id))}
              className="font-medium underline-offset-4 hover:underline"
            >
              {periodLabel(report.period)}
            </Link>
            <div className="text-muted-foreground text-xs">{report.id}</div>
          </div>
        ),
      },
      {
        id: 'name',
        header: 'Report',
        value: (report) => REPORT_FORMS[report.level].name,
      },
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
        value: (report) => validationText(report),
        cell: (report) => (
          <span className={report.status === 'errors' ? 'text-destructive' : undefined}>
            {validationText(report)}
          </span>
        ),
      },
      {
        id: 'status',
        filter: 'select',
        header: 'Status',
        value: (report) => reporterStatus(report).label,
        cell: (report) => {
          const status = reporterStatus(report);
          return <StatusBadge status={status.label} tone={status.tone} />;
        },
      },
    ],
    [workspace, linkTo],
  );

  if (reports.isPending) return <PageSkeleton layout="table" />;
  if (reports.isError) {
    return (
      <div className="bg-card rounded-card border">
        <ErrorState
          title="Could not load your monthly reports"
          error={reports.error}
          onRetry={() => void reports.refetch()}
          isRetrying={reports.isRefetching}
        />
      </div>
    );
  }

  const [newest] = reports.data;
  if (!newest) {
    return (
      <div className="gap-section flex flex-col">
        <SampleDataNotice subject="The reports" />
        <div className="bg-card rounded-card border">
          <EmptyState
            icon={ClipboardList}
            title="No reports yet"
            description="A report is created for you when each month closes. It is due on the 20th of the following month."
          />
        </div>
      </div>
    );
  }

  const selected = reports.data.find((report) => report.period === month) ?? newest;

  return (
    <div className="gap-section flex flex-col">
      <SampleDataNotice subject="The reports" />
      <div className="w-full sm:w-64">
        <SelectField
          label="Reporting month"
          required
          value={selected.period}
          onValueChange={(value) => {
            router.replace(linkTo(`${listPath}?month=${encodeURIComponent(value)}`));
          }}
          options={reports.data.map((report) => ({
            value: report.period,
            label: periodLabel(report.period),
          }))}
          placeholder="Choose a month"
        />
      </div>
      <MonthCard report={selected} href={linkTo(REPORT_PATHS.report(workspace, selected.id))} />
      <DataTable
        label="Report history"
        preferencesKey="report-history"
        columns={columns}
        rows={reports.data}
        getRowId={(report) => report.id}
        searchPlaceholder="Search reports…"
        emptyTitle="No reports yet"
        rowActions={(report) => (
          <RowActions
            label={`Actions for ${report.id}`}
            actions={[
              {
                label: report.status === 'submitted' ? 'View report' : 'Open report',
                icon: report.status === 'submitted' ? Eye : Pencil,
                onSelect: () => {
                  router.push(linkTo(REPORT_PATHS.report(workspace, report.id)));
                },
              },
            ]}
          />
        )}
      />
    </div>
  );
}

/** One month's report: where it stands and the one thing to do next. */
function MonthCard({ report, href }: { report: MonthlyReport; href: string }) {
  const now = new Date();
  const status = reporterStatus(report);
  const errors = report.errors.length;
  const errorWord = `${errors} error${errors === 1 ? '' : 's'}`;
  const message = {
    draft:
      report.saved_at === null
        ? `${prefilledLine(report)} Add the rest.`
        : `Draft saved ${formatTimestamp(report.saved_at, now)}. ${prefilledLine(report)}`,
    errors: `Validation found ${errorWord}. Fix ${errors === 1 ? 'it' : 'them'} and send again.`,
    submitted: `Sent ${formatTimestamp(report.submitted_at, now)}${report.receipt ? ` · server receipt ${report.receipt}` : ''}.`,
  }[report.status];
  const action = {
    draft: report.saved_at === null ? 'Start report' : 'Continue report',
    errors: 'Fix errors',
    submitted: 'View report',
  }[report.status];

  return (
    <DetailHeader
      title={reportTitle(report)}
      status={<StatusBadge status={status.label} tone={status.tone} />}
      description={`${report.unit.name} · due ${formatDate(report.due_on)}`}
      actions={
        <Button asChild variant={report.status === 'submitted' ? 'outline' : 'default'}>
          <Link href={href}>
            {action}
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      }
    >
      <StepTracker
        aria-label="Report progress"
        steps={reportSteps(report, { problems: null, isSending: false }, now)}
      />
      <p className="text-muted-foreground mt-3 text-sm">{message}</p>
    </DetailHeader>
  );
}

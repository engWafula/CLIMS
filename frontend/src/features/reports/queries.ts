import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useApiQuery, useHttp } from '@/lib/api';

import {
  getReport,
  listCoverage,
  listOwnReports,
  listPeriods,
  listReports,
  markReviewed,
  remindReporter,
  saveReport,
  submitReport,
  type MonthlyReport,
  type OwnReportsScope,
  type ReportInput,
} from './api';
import { periodLabel } from './status';

/*
 * Every key starts with `reports`: sending one report changes the reporter's
 * list, MOH's list and the coverage figures, so each write refetches the lot.
 */
const ROOT = 'reports';
export const reportKeys = {
  all: [ROOT] as const,
  own: (scope: OwnReportsScope) => [ROOT, 'own', scope.level, scope.store ?? null] as const,
  period: (period: string) => [ROOT, 'period', period] as const,
  periods: [ROOT, 'periods'] as const,
  coverage: (period: string) => [ROOT, 'coverage', period] as const,
  report: (id: string) => [ROOT, 'report', id] as const,
};

export function useOwnReports(scope: OwnReportsScope) {
  return useApiQuery(reportKeys.own(scope), (http, signal) => listOwnReports(http, scope, signal));
}

/** Every unit's report for `period`. */
export function usePeriodReports(period: string) {
  return useApiQuery(reportKeys.period(period), (http, signal) =>
    listReports(http, period, signal),
  );
}

export function useReportPeriods() {
  return useApiQuery(reportKeys.periods, listPeriods);
}

export function useReportCoverage(period: string) {
  return useApiQuery(reportKeys.coverage(period), (http, signal) =>
    listCoverage(http, period, signal),
  );
}

export function useReport(id: string, editing = false) {
  return useApiQuery(
    reportKeys.report(id),
    (http, signal) => getReport(http, id, signal),
    editing
      ? { refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false }
      : { refetchInterval: 60_000 },
  );
}

/** Puts the server's copy of a report straight into the cache, then refetches everything about reports. */
function useReportWrite<Input>(
  write: (input: Input) => Promise<MonthlyReport>,
  success: (report: MonthlyReport) => string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: (report) => {
      queryClient.setQueryData(reportKeys.report(report.id), report);
      toast.success(success(report));
    },
    // A rejected submission changes the report too (its status, checks and history).
    onSettled: () => queryClient.invalidateQueries({ queryKey: reportKeys.all }),
    // The report page shows the failure, and maps field errors to their inputs.
    meta: { handlesOwnErrors: true },
  });
}

export function useSaveReport(id: string) {
  const http = useHttp();
  return useReportWrite(
    (input: ReportInput) => saveReport(http, id, input),
    () => 'Draft saved.',
  );
}

export function useSubmitReport(id: string) {
  const http = useHttp();
  return useReportWrite(
    (input: ReportInput) => submitReport(http, id, input),
    (report) =>
      `${periodLabel(report.period)} report sent to MOH.${report.receipt ? ` Receipt ${report.receipt}.` : ''}`,
  );
}

/** Marks a sent report as reviewed by MOH, quietly: it happens when the report is opened. */
export function useMarkReviewed(id: string) {
  const http = useHttp();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => markReviewed(http, id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: reportKeys.all });
    },
    // Failing to record the review must not get in the way of reading the report.
    meta: { handlesOwnErrors: true },
  });
}

export function useRemindReporter() {
  const http = useHttp();
  return useMutation({
    mutationFn: (report: MonthlyReport) => remindReporter(http, report.id),
    onSuccess: (_result, report) => {
      toast.success(`Reminder sent to ${report.reporter}.`);
    },
  });
}

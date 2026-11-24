'use client';

import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';

import { SelectField } from '@/components/form/SelectField';
import { TextField } from '@/components/form/TextField';
import { SampleDataNotice } from '@/components/SampleData';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { RecordView } from '@/components/RecordView';
import type { ProductKey } from '@/features/fulfilment/products';
import { toApiError } from '@/lib/api';
import { formatDate, formatTimestamp } from '@/lib/format';
import { WriteAction } from '@/components/WriteAction';

import type { FigureKey, MonthlyReport } from './api';
import {
  anyLosses,
  checkReport,
  draftFrom,
  fieldId,
  inputFrom,
  LOSS_REASONS,
  REPORT_FORMS,
  type ReportDraft,
  type ReportProblem,
} from './figures';
import { useReport, useSaveReport, useSubmitReport } from './queries';
import {
  ChecksCard,
  FactsCard,
  FiguresCard,
  HistoryCard,
  prefilledLine,
  ReportHeader,
} from './ReportParts';
import { SentReport } from './SentReport';
import { daysInPeriod, monthName, periodLabel, REPORT_PATHS, reportSteps } from './status';

interface ReportPageProps {
  /** The workspace the page sits in, for its links. */
  workspace: 'dcfp' | 'warehouse';
  /** Adds what the workspace keeps in its links (the warehouse's `?store=`) to a path. */
  linkTo?: (path: string) => string;
}

/** A reporter's monthly report: fill it in, have it checked, send it; then a read-only copy. */
export default function ReportPage({ workspace, linkTo = (path) => path }: ReportPageProps) {
  const { id } = useParams<{ id: string }>();
  const report = useReport(id, true);
  return (
    <div className="gap-section flex flex-col">
      <SampleDataNotice subject="The report figures" />
      <RecordView
        query={report}
        layout="form"
        noun="report"
        back={{ href: linkTo(REPORT_PATHS.list(workspace)), label: 'Back to monthly reports' }}
      >
        {(data) =>
          data.status === 'submitted' ? (
            <SentReport report={data} viewer="reporter" />
          ) : (
            <ReportEditor key={data.id} report={data} />
          )
        }
      </RecordView>
    </div>
  );
}

/** A problem as shown on the page: the check's own, or one the server sent back. */
interface ShownProblem extends Omit<ReportProblem, 'field'> {
  field: string;
}

function serverProblems(report: MonthlyReport): ShownProblem[] {
  return report.errors.map((error) => ({ ...error, where: whereOf(report, error.field) }));
}

/** "Male · Closing balance" for `male.closing`; the field name itself for one the page does not know. */
function whereOf(report: MonthlyReport, field: string): string {
  const form = REPORT_FORMS[report.level];
  const [product, key] = field.split('.');
  const row = form.rows.find((candidate) => candidate.key === key);
  if (row && (product === 'male' || product === 'female')) {
    return `${product === 'male' ? 'Male' : 'Female'} · ${row.label}`;
  }
  if (field === 'days_out_of_stock') return form.daysOut?.label ?? 'Days out of stock';
  if (field === 'loss_reason') return 'Reason for losses';
  return field;
}

function ReportEditor({ report }: { report: MonthlyReport }) {
  const now = new Date();
  const form = REPORT_FORMS[report.level];
  const save = useSaveReport(report.id);
  const submit = useSubmitReport(report.id);

  const [draft, setDraft] = useState<ReportDraft>(() => draftFrom(report));
  const [isDirty, setIsDirty] = useState(false);
  // A report the server sent back is checked live from the start.
  const [hasChecked, setHasChecked] = useState(report.status === 'errors');
  const [returned, setReturned] = useState<ShownProblem[]>(() => serverProblems(report));
  const [failure, setFailure] = useState<string | null>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const daysOutRef = useRef<HTMLInputElement>(null);
  const lossReasonRef = useRef<HTMLButtonElement>(null);

  const target = { level: report.level, period: report.period, prefilled: report.prefilled };
  const found = hasChecked ? checkReport(target, draft) : [];
  // The server's findings stay until the field they are about is changed or the check finds it too.
  const problems: ShownProblem[] = [
    ...found,
    ...returned.filter((problem) => !found.some((mine) => mine.field === problem.field)),
  ];
  const messages = new Map(problems.map((problem) => [problem.field, problem.message]));
  const isBusy = save.isPending || submit.isPending;
  const showLossReason = anyLosses(draft) || draft.lossReason !== '';
  const days = daysInPeriod(report.period);

  function edit(change: (current: ReportDraft) => ReportDraft, field: string) {
    setDraft(change);
    setIsDirty(true);
    setReturned((current) => current.filter((problem) => problem.field !== field));
  }

  function setFigure(product: ProductKey, key: FigureKey, value: string) {
    edit(
      (current) => ({
        ...current,
        figures: { ...current.figures, [product]: { ...current.figures[product], [key]: value } },
      }),
      `${product}.${key}`,
    );
  }

  function focusField(field: string) {
    if (field === 'days_out_of_stock') daysOutRef.current?.focus();
    else if (field === 'loss_reason') lossReasonRef.current?.focus();
    else document.getElementById(fieldId(field))?.focus();
  }

  function onFailure(error: unknown) {
    const apiError = toApiError(error);
    const fields = Object.entries(apiError.fieldErrors);
    if (apiError.kind === 'validation' && fields.length > 0) {
      setReturned(
        fields.map(([field, list]) => ({
          field,
          check: 'balance',
          where: whereOf(report, field),
          message: list[0] ?? apiError.message,
        })),
      );
      setHasChecked(true);
    }
    setFailure(apiError.message);
  }

  function send() {
    setFailure(null);
    setHasChecked(true);
    if (checkReport(target, draft).length > 0) {
      // The list of problems is the next thing to read.
      requestAnimationFrame(() => bannerRef.current?.focus());
      return;
    }
    submit.mutate(inputFrom(draft, report.level), { onError: onFailure });
  }

  function saveDraft() {
    setFailure(null);
    save.mutate(inputFrom(draft, report.level), {
      onError: onFailure,
      onSuccess: () => {
        setIsDirty(false);
      },
    });
  }

  const steps = reportSteps(
    report,
    { problems: hasChecked ? problems.length : null, isSending: submit.isPending },
    now,
  );

  return (
    <div className="gap-section flex flex-col">
      <ReportHeader report={report} viewer="reporter" steps={steps} />

      <div className="gap-section grid lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="gap-section flex min-w-0 flex-col">
          <div ref={bannerRef} tabIndex={-1} className="rounded-lg outline-none">
            {submit.isPending ? (
              <Alert variant="info">
                <AlertTitle>Sending to the MOH server…</AlertTitle>
                <AlertDescription>
                  The figures passed the check. Keep this page open until it is sent.
                </AlertDescription>
              </Alert>
            ) : problems.length > 0 ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {problems.length} {problems.length === 1 ? 'error' : 'errors'} to fix before this
                  report can be sent
                </AlertTitle>
                <AlertDescription>
                  <p>Correct these fields, then send again. CLIMS re-checks everything.</p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {problems.map((problem) => (
                      <li key={`${problem.field}-${problem.check}`}>
                        <Button
                          variant="link"
                          size="sm"
                          type="button"
                          onClick={() => {
                            focusField(problem.field);
                          }}
                          className="block h-auto rounded-sm p-0 text-left whitespace-normal text-current"
                        >
                          <span className="font-semibold">{problem.where}:</span> {problem.message}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : hasChecked && report.status === 'errors' ? (
              <Alert variant="info">
                <AlertTitle>All flagged fields changed</AlertTitle>
                <AlertDescription>
                  Send again: CLIMS will re-check the whole report.
                </AlertDescription>
              </Alert>
            ) : hasChecked ? (
              <Alert variant="success">
                <AlertTitle>The figures balance</AlertTitle>
                <AlertDescription>Nothing to fix. Send the report to MOH.</AlertDescription>
              </Alert>
            ) : (
              <Alert variant="info">
                <AlertTitle>Enter your {monthName(report.period)} figures</AlertTitle>
                <AlertDescription>
                  {prefilledLine(report)} When you send, CLIMS checks the figures first: if anything
                  is wrong you fix it here before it reaches MOH.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <FiguresCard
            report={report}
            draft={draft}
            problems={messages}
            disabled={isBusy}
            onChange={setFigure}
          />

          {form.daysOut || showLossReason ? (
            <Card>
              <CardHeader>
                <CardTitle>{form.otherTitle}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {form.daysOut ? (
                  <TextField
                    ref={daysOutRef}
                    label={form.daysOut.label}
                    required
                    inputMode="numeric"
                    autoComplete="off"
                    value={draft.daysOut}
                    onChange={(event) => {
                      const value = event.target.value;
                      edit((current) => ({ ...current, daysOut: value }), 'days_out_of_stock');
                    }}
                    description={`${form.daysOut.hint ? `${form.daysOut.hint}. ` : ''}0 to ${days}.`}
                    error={messages.get('days_out_of_stock')}
                    disabled={isBusy}
                  />
                ) : null}
                {showLossReason ? (
                  <SelectField
                    triggerRef={lossReasonRef}
                    label="Reason for losses & adjustments"
                    required
                    value={draft.lossReason}
                    onValueChange={(value) => {
                      edit((current) => ({ ...current, lossReason: value }), 'loss_reason');
                    }}
                    options={LOSS_REASONS.map((reason) => ({ value: reason, label: reason }))}
                    placeholder="Choose…"
                    error={messages.get('loss_reason')}
                    disabled={isBusy}
                  />
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Comment for MOH</CardTitle>
            </CardHeader>
            <CardContent>
              <Field>
                <FieldLabel htmlFor="report-comment">
                  Comment <span className="text-muted-foreground font-normal">(optional)</span>
                </FieldLabel>
                <Textarea
                  id="report-comment"
                  rows={3}
                  value={draft.comment}
                  onChange={(event) => {
                    const value = event.target.value;
                    edit((current) => ({ ...current, comment: value }), 'comment');
                  }}
                  placeholder="Anything that explains this month's figures"
                  disabled={isBusy}
                />
              </Field>
            </CardContent>
          </Card>

          <HistoryCard report={report} />
        </div>

        <div className="gap-section flex min-w-0 flex-col">
          <FactsCard
            title="Send to MOH"
            items={[
              { label: 'Recipient', value: 'MOH · AIDS Control Programme' },
              { label: 'Reporting unit', value: report.unit.name },
              { label: 'Period', value: periodLabel(report.period) },
              { label: 'Due', value: formatDate(report.due_on) },
              {
                label: 'Draft',
                value: isDirty ? (
                  <span className="text-warning">Unsaved changes</span>
                ) : report.saved_at ? (
                  `Saved ${formatTimestamp(report.saved_at, now)}`
                ) : (
                  'Not saved yet'
                ),
              },
            ]}
          >
            {failure ? (
              <Alert variant="destructive">
                <AlertTitle>That did not go through</AlertTitle>
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            ) : null}
            <WriteAction>
              <div className="flex flex-col gap-2">
                <Button onClick={send} disabled={isBusy}>
                  {submit.isPending ? (
                    <Spinner data-icon="inline-start" aria-hidden="true" />
                  ) : null}
                  {submit.isPending
                    ? 'Sending…'
                    : report.status === 'errors' || problems.length > 0
                      ? 'Re-check and send'
                      : 'Validate and send'}
                </Button>
                <Button variant="outline" onClick={saveDraft} disabled={!isDirty || isBusy}>
                  {save.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
                  Save draft
                </Button>
              </div>
            </WriteAction>
            <p className="text-muted-foreground text-xs">
              CLIMS checks the report before it leaves. If something is wrong it comes back to you
              to fix: nothing reaches MOH until it passes.
            </p>
          </FactsCard>
          <ChecksCard
            problems={hasChecked ? problems : null}
            description={
              report.validation_runs > 0
                ? `Run ${report.validation_runs} time${report.validation_runs === 1 ? '' : 's'}`
                : 'Runs when you send'
            }
          />
        </div>
      </div>
    </div>
  );
}

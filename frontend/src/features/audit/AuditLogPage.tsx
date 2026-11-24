'use client';

import { Copy, History, UserRound, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useId } from 'react';

import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { RowActions, type RowActionItem } from '@/components/data-table/RowActions';
import { FilterSelect } from '@/components/FilterSelect';
import { FilterTabs } from '@/components/FilterTabs';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeDevice } from '@/features/auth/deviceSessions';
import { roleLabel } from '@/features/users/access';
import { copyText } from '@/lib/copyText';
import { formatTimestamp } from '@/lib/format';

import {
  actionLabel,
  actorLabel,
  areaLabel,
  AUDIT_AREAS,
  entrySummary,
  formatValue,
  humanize,
  NO_FILTERS,
  shortId,
  subjectLabel,
  type AuditArea,
  type AuditEntry,
  type AuditFilters,
  type AuditSubject,
} from './api';
import { auditFiltersFrom, auditHref } from './links';
import { useAuditLog } from './queries';

const AREA_OPTIONS = [
  { value: 'all', label: 'All areas' },
  ...AUDIT_AREAS.map((area) => ({ value: area, label: areaLabel(area) })),
] as const;

const OUTCOME_TABS = [
  { value: 'all', label: 'All' },
  { value: 'success', label: 'Succeeded' },
  { value: 'failure', label: 'Failed' },
] as const;

const isArea = (value: string): value is AuditArea => AUDIT_AREAS.some((area) => area === value);

type Go = (next: Partial<AuditFilters>) => void;

/** "User felix" where the API names the record, otherwise "Hotspot 1a2b3c4d". */
function subjectName(subject: AuditSubject, typeCase: 'upper' | 'lower' = 'upper'): string {
  const type = subjectLabel(subject.type);
  return `${typeCase === 'lower' ? type.toLowerCase() : type} ${subject.name ?? shortId(subject.id)}`;
}

/** The subject with its name from any loaded entry that mentions it; the address carries only its ID. */
function namedIn(entries: readonly AuditEntry[], subject: AuditSubject): AuditSubject {
  for (const entry of entries) {
    const found = entry.subjects.find(
      (candidate) => candidate.type === subject.type && candidate.id === subject.id,
    );
    if (found?.name) return found;
  }
  return subject;
}

/** Where the request came from: "41.210.1.2 · Chrome on Android". */
function sourceOf(entry: AuditEntry): string | null {
  const device = entry.user_agent ? describeDevice(entry.user_agent).label : null;
  return [entry.ip_address, device].filter(Boolean).join(' · ') || null;
}

/**
 * Who did what, to which record, what changed and from where, newest first.
 * The server filters and pages the log; the table's own search and sorting
 * apply to the entries loaded so far.
 */
export default function AuditLogPage() {
  const router = useRouter();
  const filters = auditFiltersFrom(useSearchParams());
  const log = useAuditLog(filters);
  const entries = log.data?.pages.flat();
  const isFiltered = Object.values(filters).some((value) => value !== null);
  const go: Go = (next) => {
    router.replace(auditHref({ ...filters, ...next }), { scroll: false });
  };

  return (
    <div className="gap-section flex flex-col">
      <div className="flex flex-wrap items-center gap-3">
        <FilterTabs
          label="Filter by outcome"
          value={filters.outcome ?? 'all'}
          hrefFor={(value) => auditHref({ ...filters, outcome: value === 'all' ? null : value })}
          tabs={OUTCOME_TABS}
        />
        {filters.actor ? (
          <FilterChip
            label={`Actions by user ${shortId(filters.actor)}`}
            onClear={() => {
              go({ actor: null });
            }}
          />
        ) : null}
        {filters.subject ? (
          <FilterChip
            label={`History of ${subjectName(namedIn(entries ?? [], filters.subject), 'lower')}`}
            onClear={() => {
              go({ subject: null });
            }}
          />
        ) : null}
      </div>
      <DataTable
        label="Audit log"
        columns={AUDIT_COLUMNS}
        rows={entries}
        getRowId={(entry) => entry.id}
        isLoading={log.isPending}
        error={log.error}
        onRetry={() => void log.refetch()}
        isRetrying={log.isRefetching}
        preferencesKey="audit-log"
        pageSize={25}
        searchPlaceholder="Search loaded entries…"
        more={{
          hasMore: log.hasNextPage,
          isLoading: log.isFetchingNextPage,
          onLoadMore: () => void log.fetchNextPage(),
          noun: 'entries',
        }}
        toolbar={
          <>
            <FilterSelect
              label="Area"
              value={filters.area ?? 'all'}
              options={AREA_OPTIONS}
              onValueChange={(value) => {
                go({ area: isArea(value) ? value : null });
              }}
            />
            <DateFilter
              label="From"
              value={filters.from}
              max={filters.to}
              onChange={(from) => {
                go({ from });
              }}
            />
            <DateFilter
              label="To"
              value={filters.to}
              min={filters.from}
              onChange={(to) => {
                go({ to });
              }}
            />
          </>
        }
        emptyTitle={isFiltered ? 'No entries match these filters' : 'Nothing recorded yet'}
        emptyDescription={
          isFiltered
            ? 'Change or clear the filters to see the rest.'
            : 'Sign-ins, account changes and every change to records will be listed here.'
        }
        emptyAction={
          isFiltered ? (
            <Button
              variant="outline"
              onClick={() => {
                router.replace(auditHref(NO_FILTERS));
              }}
            >
              Clear filters
            </Button>
          ) : undefined
        }
        renderExpanded={(entry) => <AuditDetail entry={entry} go={go} />}
        expandLabel={(entry) =>
          `Show details of ${actionLabel(entry.action).toLowerCase()} at ${formatTimestamp(entry.occurred_at)}`
        }
        rowActions={(entry) => <EntryActions entry={entry} go={go} />}
      />
    </div>
  );
}

function DateFilter({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string | null;
  min?: string | null;
  max?: string | null;
  onChange: (value: string | null) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="text-muted-foreground shrink-0 text-sm font-normal">
        {label}
      </Label>
      <Input
        id={id}
        type="date"
        className="bg-card h-8 w-36"
        value={value ?? ''}
        min={min ?? undefined}
        max={max ?? undefined}
        onChange={(event) => {
          onChange(event.target.value || null);
        }}
      />
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="bg-secondary inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-3 text-sm">
      {label}
      <Button variant="ghost" size="icon-xs" aria-label={`Clear: ${label}`} onClick={onClear}>
        <X />
      </Button>
    </span>
  );
}

// The server applies the area, outcome and date filters, so the columns offer none of their own.
const AUDIT_COLUMNS: DataTableColumn<AuditEntry>[] = [
  {
    id: 'occurred_at',
    filter: false,
    header: 'When',
    value: (entry) => entry.occurred_at,
    cell: (entry) => (
      <time dateTime={entry.occurred_at} className="whitespace-nowrap">
        {formatTimestamp(entry.occurred_at)}
      </time>
    ),
  },
  {
    id: 'actor',
    filter: false,
    header: 'Who',
    value: (entry) => actorLabel(entry),
    cell: (entry) => (
      <span className="block max-w-48 truncate font-medium" title={actorLabel(entry)}>
        {actorLabel(entry)}
      </span>
    ),
  },
  {
    id: 'action',
    filter: false,
    header: 'Action',
    value: (entry) => actionLabel(entry.action),
    cell: (entry) => (
      <span className="flex items-center gap-2 whitespace-nowrap">
        {actionLabel(entry.action)}
        {entry.outcome === 'failure' ? <StatusBadge status="Failed" tone="negative" /> : null}
      </span>
    ),
  },
  {
    id: 'record',
    filter: false,
    header: 'Record',
    value: (entry) =>
      [entry.target ? subjectName(entry.target) : '', entrySummary(entry) ?? ''].join(' '),
    cell: (entry) => {
      const summary = entrySummary(entry);
      return (
        <div className="flex max-w-[40rem] min-w-56 flex-col">
          <span className="font-medium">{entry.target ? subjectName(entry.target) : '—'}</span>
          {summary ? (
            <span className="text-muted-foreground truncate text-xs" title={summary}>
              {summary}
            </span>
          ) : null}
        </div>
      );
    },
  },
  {
    id: 'source',
    filter: false,
    header: 'From',
    value: (entry) => sourceOf(entry),
    defaultHidden: true,
  },
];

function EntryActions({ entry, go }: { entry: AuditEntry; go: Go }) {
  const { target, actor } = entry;
  const actions: RowActionItem[] = [];
  if (target) {
    actions.push({
      label: "Show this record's history",
      icon: History,
      onSelect: () => {
        go({ subject: target });
      },
    });
  }
  if (actor) {
    actions.push({
      label: `Show actions by ${actorLabel(entry)}`,
      icon: UserRound,
      onSelect: () => {
        go({ actor: actor.id });
      },
    });
  }
  if (target) {
    actions.push({
      label: 'Copy record ID',
      icon: Copy,
      onSelect: () => {
        void copyText(target.id, 'record ID');
      },
    });
  }
  if (actions.length === 0) return null;
  return (
    <RowActions
      label={`Actions for ${actionLabel(entry.action).toLowerCase()} at ${formatTimestamp(entry.occurred_at)}`}
      actions={actions}
    />
  );
}

/** An entry opened up: what changed, its details, the records involved, and where it came from. */
function AuditDetail({ entry, go }: { entry: AuditEntry; go: Go }) {
  const label = actionLabel(entry.action);
  const changes = Object.entries(entry.changes ?? {}).map(([field, change]) => ({
    field,
    before: change.before,
    after: change.after,
  }));
  const details = Object.entries(entry.details ?? {}).filter(([, value]) => value !== null);
  const related = entry.subjects.filter(
    (subject) => !(entry.target?.type === subject.type && entry.target.id === subject.id),
  );
  const records = [...(entry.target ? [entry.target] : []), ...related];
  const roles = entry.actor?.roles ?? [];
  const source = sourceOf(entry);

  return (
    <div className="flex max-w-3xl flex-col gap-3 text-sm">
      <p>
        <span className="font-medium">{label}</span>{' '}
        <span className="text-muted-foreground font-mono text-xs">{entry.action}</span>
        {entry.reason ? <> · {humanize(entry.reason)}</> : null}
      </p>

      {changes.length > 0 ? (
        <div className="bg-card rounded-card overflow-hidden border">
          <DataTable
            variant="embedded"
            label={`What changed: ${label.toLowerCase()}`}
            rows={changes}
            getRowId={(change) => change.field}
            columns={[
              {
                id: 'field',
                header: 'Field',
                cell: (change) => <span className="font-mono text-xs">{change.field}</span>,
              },
              {
                id: 'before',
                header: 'Before',
                wrap: true,
                value: (change) => formatValue(change.before) ?? '—',
              },
              {
                id: 'after',
                header: 'After',
                wrap: true,
                value: (change) => formatValue(change.after) ?? '—',
              },
            ]}
          />
        </div>
      ) : null}

      {details.length > 0 ? (
        <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-1">
          {details.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{humanize(key)}</dt>
              <dd className="break-all">{formatValue(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {records.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Records:</span>
          {records.map((subject) => (
            <Button
              key={`${subject.type}:${subject.id}`}
              variant="outline"
              size="xs"
              title={`Show the history of ${subjectLabel(subject.type).toLowerCase()} ${subject.id}`}
              onClick={() => {
                go({ subject });
              }}
            >
              <History data-icon="inline-start" />
              {subjectName(subject)}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {roles.length > 0 ? (
          <span>Roles then: {roles.map((name) => roleLabel({ id: '', name })).join(', ')}</span>
        ) : null}
        {source ? <span title={entry.user_agent ?? undefined}>{source}</span> : null}
        {entry.request_id ? (
          <span className="inline-flex items-center gap-1">
            Request {entry.request_id}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Copy request ID"
              onClick={() => void copyText(entry.request_id ?? '', 'request ID')}
            >
              <Copy />
            </Button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

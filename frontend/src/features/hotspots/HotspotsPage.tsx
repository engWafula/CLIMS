'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/data-table/DataTable';
import { RowActions, type RowAction } from '@/components/data-table/RowActions';
import { ExportButton } from '@/components/ExportButton';
import { FilterTabs } from '@/components/FilterTabs';
import { PageActions } from '@/components/PageActions';
import { StatusBadge } from '@/components/StatusBadge';
import { DCFP_PATHS } from '@/features/dcfp/orders';

import { DECISIONS_FROM, REVIEW_STATUSES, type Hotspot, type HotspotDecision } from './api';
import { dispenserSummary, hotspotLabel } from './hotspotForm';
import { DECISION_TEXT, DecisionDialog } from './HotspotDecisionDialog';
import { useAllHotspots } from './queries';

/** The review queue's filters, by review status. */
const REVIEW_FILTERS = ['all', ...REVIEW_STATUSES] as const;
type ReviewFilter = (typeof REVIEW_FILTERS)[number];

const REVIEW_LABELS: Record<ReviewFilter, string> = {
  all: 'All',
  submitted: 'To review',
  active: 'Active',
  deactivated: 'Deactivated',
  rejected: 'Rejected',
};

const reviewFilterFrom = (value: string | null): ReviewFilter =>
  REVIEW_FILTERS.find((filter) => filter === value) ?? 'all';

const reviewHref = (filter: ReviewFilter) =>
  filter === 'all' ? DCFP_PATHS.hotspots : `${DCFP_PATHS.hotspots}?review=${filter}`;

/**
 * The DCFP's review queue: every hotspot in the district, by review status. VHTs submit hotspots
 * in the mobile app; they have no web access.
 */
export default function HotspotsPage() {
  const hotspots = useAllHotspots();
  const filter = reviewFilterFrom(useSearchParams().get('review'));
  const [deciding, setDeciding] = useState<{
    hotspot: Hotspot;
    decision: HotspotDecision;
  } | null>(null);

  const all = hotspots.data?.items;

  const columns: DataTableColumn<Hotspot>[] = [
    {
      id: 'name',
      header: 'Hotspot',
      value: (hotspot) => hotspot.name,
      cell: (hotspot) => (
        <Link
          href={DCFP_PATHS.hotspot(hotspot.id)}
          className="text-foreground font-medium underline-offset-4 hover:underline"
        >
          {hotspotLabel(hotspot)}
        </Link>
      ),
    },
    { id: 'type', filter: 'select', header: 'Type', value: (hotspot) => hotspot.type },
    {
      id: 'subcounty',
      filter: 'select',
      header: 'Subcounty',
      value: (hotspot) => hotspot.subcounty?.name,
    },
    { id: 'village', header: 'Village', value: (hotspot) => hotspot.village },
    {
      id: 'contact',
      header: 'Hotspot manager',
      value: (hotspot) => hotspot.contact_person?.name,
    },
    {
      id: 'phone',
      header: 'Manager phone',
      value: (hotspot) => hotspot.contact_person?.phone_number,
    },
    { id: 'dispenser', header: 'Dispenser', value: dispenserSummary },
    {
      id: 'status',
      filter: 'select',
      header: 'Status',
      value: (hotspot) => hotspot.review_status,
      cell: (hotspot) => <StatusBadge status={hotspot.review_status} />,
    },
  ];

  const reviewActions = (hotspot: Hotspot): RowAction[] =>
    DECISIONS_FROM[hotspot.review_status].map((decision) => ({
      label: DECISION_TEXT[decision].verb,
      icon: DECISION_TEXT[decision].icon,
      destructive: DECISION_TEXT[decision].destructive,
      onSelect: () => {
        setDeciding({ hotspot, decision });
      },
    }));

  const rows = filter !== 'all' ? all?.filter((hotspot) => hotspot.review_status === filter) : all;

  return (
    <>
      <PageActions>
        <ExportButton name="Hotspots" columns={columns} rows={rows} />
      </PageActions>

      <FilterTabs
        label="Filter hotspots by review status"
        value={filter}
        hrefFor={reviewHref}
        tabs={REVIEW_FILTERS.map((value) => ({
          value,
          label: REVIEW_LABELS[value],
          ...(all
            ? {
                count:
                  value === 'all'
                    ? all.length
                    : all.filter((hotspot) => hotspot.review_status === value).length,
              }
            : {}),
        }))}
      />

      <DataTable
        key={filter}
        label="Hotspots"
        preferencesKey="hotspots"
        columns={columns}
        rows={rows}
        getRowId={(hotspot) => hotspot.id}
        isLoading={hotspots.isPending}
        error={hotspots.error}
        onRetry={() => void hotspots.refetch()}
        isRetrying={hotspots.isRefetching}
        searchPlaceholder="Search hotspots…"
        emptyTitle={
          filter === 'all'
            ? 'No hotspots in your district yet'
            : filter === 'submitted'
              ? 'No hotspots to review'
              : `No ${REVIEW_LABELS[filter].toLowerCase()} hotspots`
        }
        emptyDescription={
          filter === 'all' || filter === 'submitted'
            ? 'Hotspots that VHTs submit in your district appear here.'
            : 'Choose another filter to see the rest of the hotspots.'
        }
        rowActions={(hotspot) => {
          const actions = reviewActions(hotspot);
          return actions.length ? (
            <RowActions label={`Actions for ${hotspotLabel(hotspot)}`} actions={actions} />
          ) : null;
        }}
      />

      {deciding ? (
        <DecisionDialog
          hotspot={deciding.hotspot}
          decision={deciding.decision}
          onClose={() => {
            setDeciding(null);
          }}
        />
      ) : null}
    </>
  );
}

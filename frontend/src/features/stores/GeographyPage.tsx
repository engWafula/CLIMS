'use client';

import { ChevronDown, MapPinned, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';

import { SampleDataNotice } from '@/components/SampleData';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { PageSkeleton } from '@/components/states/PageSkeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { formatNumber, formatTimestamp } from '@/lib/format';

import type { District, Geography, Region } from './api';
import { useGeography, useSyncGeography } from './queries';

const plural = (count: number, noun: string, many = `${noun}s`) =>
  `${formatNumber(count)} ${count === 1 ? noun : many}`;

/**
 * Regions, districts and sub-counties as DHIS2 has them, with a manual sync.
 * NOT YET IN THE GO API (mock data).
 */
export default function GeographyPage() {
  const geography = useGeography();

  return (
    <div className="gap-section flex flex-col">
      <SampleDataNotice subject="The organisation units" />
      {geography.isPending ? (
        <PageSkeleton layout="detail" />
      ) : geography.isError ? (
        <ErrorState
          title="Could not load the geography"
          error={geography.error}
          onRetry={() => void geography.refetch()}
          isRetrying={geography.isRefetching}
        />
      ) : (
        <GeographyView geography={geography.data} />
      )}
    </div>
  );
}

function GeographyView({ geography }: { geography: Geography }) {
  return (
    <>
      <SyncCard geography={geography} />
      {geography.regions.length === 0 ? (
        <EmptyState
          icon={MapPinned}
          title="No organisation units yet"
          description="Run a DHIS2 sync to bring in regions, districts and sub-counties."
        />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Regions">
          {geography.regions.map((region, index) => (
            <li key={region.id}>
              <RegionItem region={region} defaultOpen={index === 0} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function SyncCard({ geography }: { geography: Geography }) {
  const sync = useSyncGeography();
  const { counts } = geography;
  const figures = [
    { label: 'Regions', value: counts.regions },
    { label: 'Districts', value: counts.districts },
    { label: 'Sub-counties', value: counts.subcounties },
    { label: 'Facilities', value: counts.facilities },
  ];

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="min-w-0 lg:w-56">
          <h2 className="font-semibold">DHIS2 sync</h2>
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {sync.isPending
              ? 'Syncing with DHIS2…'
              : geography.synced_at
                ? `Last synced ${formatTimestamp(geography.synced_at).toLowerCase()} · runs nightly`
                : 'Not synced yet'}
          </p>
        </div>
        <dl className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
          {figures.map((figure) => (
            <div key={figure.label} className="flex flex-col-reverse">
              <dt className="text-muted-foreground text-xs">{figure.label}</dt>
              <dd className="text-xl font-semibold tabular-nums">{formatNumber(figure.value)}</dd>
            </div>
          ))}
        </dl>
        <Button
          variant="outline"
          disabled={sync.isPending}
          onClick={() => {
            sync.mutate();
          }}
        >
          {sync.isPending ? (
            <Spinner data-icon="inline-start" aria-hidden="true" />
          ) : (
            <RefreshCw data-icon="inline-start" />
          )}
          {sync.isPending ? 'Syncing…' : 'Sync now'}
        </Button>
      </CardContent>
    </Card>
  );
}

function Disclosure({
  title,
  meta,
  defaultOpen,
  children,
}: {
  title: string;
  meta: string;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="focus-visible:ring-ring flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 py-2.5 outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 truncate font-medium">{title}</span>
        <span className="text-muted-foreground flex shrink-0 items-center gap-2 text-xs">
          {meta}
          <ChevronDown
            aria-hidden="true"
            className="size-4 transition-transform group-open:rotate-180"
          />
        </span>
      </summary>
      <div className="pb-2 pl-3">{children}</div>
    </details>
  );
}

function RegionItem({ region, defaultOpen }: { region: Region; defaultOpen: boolean }) {
  return (
    <div className="bg-card rounded-xl border">
      <Disclosure
        title={`${region.name} region`}
        meta={plural(region.district_count, 'district')}
        defaultOpen={defaultOpen}
      >
        {region.districts.length === 0 ? (
          <p className="text-muted-foreground px-3 py-2 text-sm">No districts recorded.</p>
        ) : (
          <ul className="border-l pl-2">
            {region.districts.map((district, index) => (
              <li key={district.id}>
                <DistrictItem district={district} defaultOpen={defaultOpen && index === 0} />
              </li>
            ))}
          </ul>
        )}
      </Disclosure>
    </div>
  );
}

function districtMeta(district: District): string {
  const parts = [
    district.hotspot_count > 0 ? plural(district.hotspot_count, 'hotspot') : null,
    district.store_count > 0 ? plural(district.store_count, 'store') : null,
  ].filter(Boolean);
  return parts.length > 0
    ? parts.join(' · ')
    : plural(district.subcounties.length, 'sub-county', 'sub-counties');
}

function DistrictItem({ district, defaultOpen }: { district: District; defaultOpen: boolean }) {
  return (
    <Disclosure title={district.name} meta={districtMeta(district)} defaultOpen={defaultOpen}>
      <ul className="divide-border divide-y border-l pl-2">
        {district.subcounties.map((subcounty) => (
          <li
            key={subcounty.id}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-sm"
          >
            <span className="min-w-0">{subcounty.name}</span>
            <span className="text-muted-foreground text-xs">
              {plural(subcounty.facility_count, 'facility', 'facilities')} ·{' '}
              {plural(subcounty.hotspot_count, 'hotspot')}
            </span>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

'use client';

import { BadgeCheck, Hourglass, Package } from 'lucide-react';
import { useId, useState } from 'react';

import { BarChart } from '@/components/charts/BarChart';
import { StatCard, StatCardGrid } from '@/components/StatCard';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/format';

import { apiParams } from '../filters';
import { useHmisReport } from '../queries';
import type { ReportFilters } from '../useReportFilters';
import { piecesValue } from './shared';

/** HMIS 105 condom figures prepared from acknowledged receipts, not yet sent to DHIS2. */
export function HmisView({ filters }: { filters: ReportFilters }) {
  const report = useHmisReport(apiParams(filters.state, ['month', 'district_id']));
  const data = report.data;
  const loading = report.isPending;
  const [showDecisions, setShowDecisions] = useState(false);
  const decisionsId = useId();
  const rows = (data?.rows ?? []).map((row) => ({
    label: [row.district ?? 'No district', row.subcounty].filter(Boolean).join(' · '),
    values: { female: row.ct11_female_pieces, male: row.ct12_male_pieces },
  }));

  return (
    <div className="gap-section flex flex-col">
      <Alert variant="warning">
        <AlertTitle>Prepared, not submitted to DHIS2</AlertTitle>
        <AlertDescription>
          These are acknowledged receipts at hotspots: evidence of supply, not condoms dispensed.
          Submission stays off until the programme approves how they are counted.{' '}
          <Button
            variant="link"
            size="sm"
            type="button"
            className="h-auto px-0 text-current underline"
            aria-expanded={showDecisions}
            aria-controls={decisionsId}
            onClick={() => {
              setShowDecisions((open) => !open);
            }}
          >
            {showDecisions ? 'Hide' : 'Show'} pending decisions
          </Button>
          {showDecisions && data ? (
            <ul id={decisionsId} className="mt-2 list-disc pl-5">
              {data.pending_decisions.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          ) : null}
        </AlertDescription>
      </Alert>
      <StatCardGrid>
        <StatCard
          label="105-CT11 Female condoms"
          value={data ? piecesValue(data.total.ct11_female_pieces) : ''}
          icon={Package}
          accent="violet"
          isLoading={loading}
        />
        <StatCard
          label="105-CT12 Male condoms"
          value={data ? piecesValue(data.total.ct12_male_pieces) : ''}
          icon={Package}
          accent="info"
          isLoading={loading}
        />
        <StatCard
          label="Acknowledgements"
          value={formatNumber(data?.total.acknowledgements)}
          icon={BadgeCheck}
          accent="positive"
          isLoading={loading}
          detail={data ? `From ${formatNumber(data.total.hotspots)} hotspots` : undefined}
        />
        <StatCard
          label="Delivered, not acknowledged"
          value={formatNumber(data?.total.unacknowledged_lines)}
          icon={Hourglass}
          accent="caution"
          isLoading={loading}
          detail="Delivery lines not counted until acknowledged"
        />
      </StatCardGrid>
      <BarChart
        title="By district and subcounty"
        description={
          data
            ? `Pieces acknowledged in ${data.month}, by data element.`
            : 'Pieces acknowledged in the month, by data element.'
        }
        categoryLabel="District and subcounty"
        series={[
          { key: 'female', label: '105-CT11 Female', color: 'var(--chart-3)' },
          { key: 'male', label: '105-CT12 Male', color: 'var(--chart-1)' },
        ]}
        rows={rows.filter((row) => row.values.female + row.values.male > 0)}
        limit={15}
        isLoading={loading}
        error={report.error}
        onRetry={() => void report.refetch()}
        emptyMessage="No receipts were acknowledged at hotspots in this month."
      />
    </div>
  );
}

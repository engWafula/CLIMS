'use client';

import { Hourglass } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { ExportButton } from '@/components/ExportButton';
import { SampleDataNotice } from '@/components/SampleData';
import { EmptyState } from '@/components/states/EmptyState';
import { Button } from '@/components/ui/button';
import { RecordView } from '@/components/RecordView';
import { PRODUCTS } from '@/features/fulfilment/products';
import type { ExportColumn } from '@/lib/export/excel';
import { formatDate } from '@/lib/format';

import type { MonthlyReport } from './api';
import { REPORT_FORMS, type FigureRow } from './figures';
import { useMarkReviewed, useReport } from './queries';
import { SentReport } from './SentReport';
import { periodLabel, REPORT_PATHS } from './status';

const BACK = { href: REPORT_PATHS.list('moh'), label: 'Back to reports' };

/** A report as MOH reads it. Opening a new one records that MOH has reviewed it. */
export default function MohReportPage() {
  const { id } = useParams<{ id: string }>();
  const report = useReport(id);
  return (
    <div className="gap-section flex flex-col">
      <SampleDataNotice subject="The report figures" />
      <RecordView query={report} layout="detail" noun="report" back={BACK}>
        {(data) =>
          data.status === 'submitted' ? (
            <ReceivedReport report={data} />
          ) : (
            <div className="bg-card rounded-card border">
              <EmptyState
                icon={Hourglass}
                title={`${data.unit.name} hasn't sent this report yet`}
                description={`The ${periodLabel(data.period)} report is due ${formatDate(data.due_on)}. It appears here once it has passed its checks and been sent.`}
                action={
                  <Button asChild variant="outline">
                    <Link href={BACK.href}>{BACK.label}</Link>
                  </Button>
                }
              />
            </div>
          )
        }
      </RecordView>
    </div>
  );
}

function ReceivedReport({ report }: { report: MonthlyReport }) {
  const review = useMarkReviewed(report.id);
  const asked = useRef(false);
  const { mutate } = review;
  const needsReview = report.reviewed_at === null;

  useEffect(() => {
    if (!needsReview || asked.current) return;
    asked.current = true;
    mutate();
  }, [needsReview, mutate]);

  const columns: ExportColumn<FigureRow>[] = [
    { header: 'Item', value: (row) => row.label },
    ...PRODUCTS.map((product): ExportColumn<FigureRow> => ({
      header: `${product.name} (${product.brand})`,
      value: (row) => report.figures[product.key][row.key],
    })),
  ];

  return (
    <SentReport
      report={report}
      viewer="moh"
      actions={
        <ExportButton
          name={`${report.id} figures`}
          columns={columns}
          rows={REPORT_FORMS[report.level].rows}
        />
      }
    />
  );
}

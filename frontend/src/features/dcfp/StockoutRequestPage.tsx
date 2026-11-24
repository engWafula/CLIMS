'use client';

import { PackagePlus, Phone, Truck } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState, type RefObject } from 'react';

import { ActivityTimeline, type ActivityEntry } from '@/components/ActivityTimeline';
import { DetailHeader } from '@/components/DetailHeader';
import { DetailList } from '@/components/DetailList';
import { RecordView } from '@/components/RecordView';
import { StatusBadge } from '@/components/StatusBadge';
import { StepTracker } from '@/components/StepTracker';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCurrentUser } from '@/features/auth/hooks';
import { useCan } from '@/features/auth/queries';
import { useFocusWhenLost } from '@/hooks/useFocusWhenLost';
import { formatNumber, formatTimestamp } from '@/lib/format';
import { useReadOnly } from '@/navigation/useAccess';

import type { StockoutDetail } from './api';
import {
  DCFP_PATHS,
  stockoutLinks,
  type OrderScope,
  isStockoutClosed,
  placeOf,
  STOCKOUT_STATUS,
  stockoutStatus,
  stockoutSteps,
} from './orders';
import { useStockout } from './queries';
import { RejectRequestPanel } from './RejectRequestPanel';
import { SendStockForm } from './SendStockForm';
import { repeatsLabel } from './StockoutsPage';

/**
 * One hotspot's stockout request: what it asked for, sending it stock (or rejecting it before any
 * goes), and what it confirmed.
 */
export default function StockoutRequestPage({ scope = 'district' }: { scope?: OrderScope }) {
  const links = stockoutLinks(scope);
  const { id } = useParams<{ id: string }>();
  const report = useStockout(id);
  // Sending replaces the form (or closes it); focus goes to the banner that says what is true now.
  const bannerRef = useRef<HTMLDivElement>(null);
  useFocusWhenLost(
    bannerRef,
    report.data
      ? `${stockoutStatus(report.data)}:${String(report.data.deliveries.length)}`
      : undefined,
  );
  return (
    <RecordView
      query={report}
      layout="stockout"
      noun="stockout request"
      back={{
        href: links.list,
        label: links.national ? 'Back to hotspot requests' : 'Back to stockouts',
      }}
    >
      {(data) => (
        <RequestDetail
          key={`${data.id}:${stockoutStatus(data)}:${String(data.deliveries.length)}`}
          report={data}
          bannerRef={bannerRef}
        />
      )}
    </RecordView>
  );
}

function RequestDetail({
  report,
  bannerRef,
}: {
  report: StockoutDetail;
  bannerRef: RefObject<HTMLDivElement | null>;
}) {
  const storeId = useCurrentUser()?.store_id ?? undefined;
  const can = useCan();
  const readOnly = useReadOnly();
  const [sendingMore, setSendingMore] = useState(false);
  // Cancelling removes the form; focus goes back to the button that opened it.
  const sendMoreRef = useRef<HTMLButtonElement>(null);
  const wasSendingMore = useRef(false);
  useEffect(() => {
    if (wasSendingMore.current && !sendingMore) sendMoreRef.current?.focus();
    wasSendingMore.current = sendingMore;
  }, [sendingMore]);
  // Rejecting hides the send form (keeping what was typed); cancelling brings it back, with focus
  // on the button that opened the rejection.
  const [rejecting, setRejecting] = useState(false);
  const rejectRef = useRef<HTMLButtonElement>(null);
  const wasRejecting = useRef(false);
  useEffect(() => {
    if (wasRejecting.current && !rejecting) rejectRef.current?.focus();
    wasRejecting.current = rejecting;
  }, [rejecting]);
  const status = stockoutStatus(report);
  const closed = isStockoutClosed(status);
  const ownStore = storeId !== undefined && report.district_store_id === storeId;
  const canSend = !readOnly && can('orders:supply_hotspots') && ownStore && !closed;
  // A request can be rejected only before any stock has gone to it.
  const canReject = canSend && status === 'awaiting_supply' && report.deliveries.length === 0;
  const contact = report.hot_spot.contact_name?.trim() || null;
  const phone = report.hot_spot.contact_phone?.trim();
  const banner = bannerFor(report, status, contact, canSend);
  const described = [
    placeOf(report),
    `Reported ${formatTimestamp(report.created_at)}`,
    report.repeat_count ? repeatsLabel(report.repeat_count).toLowerCase() : null,
  ].filter(Boolean);

  return (
    <div className="gap-section flex flex-col">
      <DetailHeader
        title={report.hot_spot.name}
        status={
          <StatusBadge status={STOCKOUT_STATUS[status].label} tone={STOCKOUT_STATUS[status].tone} />
        }
        description={described.join(' · ')}
      >
        <StepTracker aria-label="Request progress" steps={stockoutSteps(status)} />
      </DetailHeader>

      {/* Below lg the request and contact come before the history, so Call is not at the bottom. */}
      <div className="gap-section grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr]">
        <div className="gap-section flex min-w-0 flex-col">
          <Alert ref={bannerRef} tabIndex={-1} variant={banner.variant} role="status">
            <AlertTitle>{banner.title}</AlertTitle>
            {banner.body ? (
              <AlertDescription className="break-words">{banner.body}</AlertDescription>
            ) : null}
          </Alert>
          {canSend && storeId ? (
            status === 'awaiting_supply' ? (
              <>
                <div hidden={rejecting} className="min-w-0">
                  <SendStockForm
                    report={report}
                    storeId={storeId}
                    onReject={
                      canReject
                        ? () => {
                            setRejecting(true);
                          }
                        : undefined
                    }
                    rejectRef={rejectRef}
                  />
                </div>
                {rejecting ? (
                  <RejectRequestPanel
                    report={report}
                    onCancel={() => {
                      setRejecting(false);
                    }}
                  />
                ) : null}
              </>
            ) : sendingMore ? (
              <SendStockForm
                report={report}
                storeId={storeId}
                onCancel={() => {
                  setSendingMore(false);
                }}
                onSent={() => {
                  setSendingMore(false);
                }}
              />
            ) : (
              <div>
                <Button
                  ref={sendMoreRef}
                  variant="outline"
                  onClick={() => {
                    setSendingMore(true);
                  }}
                >
                  <Truck aria-hidden="true" />
                  Send more stock
                </Button>
              </div>
            )
          ) : null}
          {!ownStore && !readOnly && can('orders:supply_hotspots') ? (
            <Alert variant="info">
              <AlertTitle>Another district store answers this request</AlertTitle>
              <AlertDescription>
                Only the hotspot&apos;s own district store can send it stock.
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        {/* One card for the request and who to call: the hotspot's place is already in the header. */}
        <div className="flex min-w-0 flex-col lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <Card>
            <CardHeader>
              <CardTitle>Request</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <DetailList
                className="wrap-anywhere"
                items={[
                  { label: 'Asked for', value: capitalise(report.product) },
                  { label: 'Message', value: report.comment || 'No message' },
                  { label: 'Reported by', value: report.reported_by },
                  ...(report.repeat_count && report.last_reported_at
                    ? [{ label: 'Last reported', value: formatTimestamp(report.last_reported_at) }]
                    : []),
                  { label: 'Contact', value: contact ?? 'No contact recorded' },
                ]}
              />
              {phone || (!readOnly && can('orders:replenish') && !closed) ? (
                <div className="flex flex-col gap-2">
                  {phone ? (
                    <Button variant="outline" size="sm" asChild>
                      <a href={`tel:${phone.replace(/\s+/g, '')}`}>
                        <Phone aria-hidden="true" />
                        Call {phone}
                      </a>
                    </Button>
                  ) : null}
                  {!readOnly && can('orders:replenish') && !closed ? (
                    <Button variant="outline" size="sm" asChild>
                      <Link href={DCFP_PATHS.newOrderFor(report.selection)}>
                        <PackagePlus aria-hidden="true" />
                        Order from a warehouse
                      </Link>
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 lg:col-start-1 lg:self-start">
          <History report={report} />
        </div>
      </div>
    </div>
  );
}

function bannerFor(
  report: StockoutDetail,
  status: ReturnType<typeof stockoutStatus>,
  contact: string | null,
  canSend: boolean,
): {
  variant: 'info' | 'success' | 'warning' | 'destructive';
  title: string;
  body: string | null;
} {
  // Who confirms receipt, to start a sentence.
  const subject = contact ?? 'The hotspot manager';
  switch (status) {
    case 'awaiting_supply':
      return {
        variant: 'warning',
        title: `${report.hot_spot.name} is out of ${report.product}`,
        // The send form right below says what to do, so the banner only names the need.
        body: canSend ? null : 'Waiting for the district store to send stock.',
      };
    case 'rejected': {
      const by = report.rejected_by?.trim();
      const when = report.rejected_at ? formatTimestamp(report.rejected_at) : null;
      return {
        variant: 'destructive',
        title: 'This request was rejected',
        body: [
          report.rejection_reason
            ? `Reason: “${report.rejection_reason}”`
            : 'No reason was recorded.',
          [by ? `Rejected by ${by}` : 'Rejected', when ? `on ${when}` : null]
            .filter(Boolean)
            .join(' ') + '.',
          `The hotspot was told. If ${report.hot_spot.name} reports again, a new request opens.`,
        ].join(' '),
      };
    }
    case 'awaiting_acknowledgement':
      return {
        variant: 'info',
        title: 'Stock is on its way',
        body: `${subject} confirms what arrives. Send more only if the hotspot still needs it.`,
      };
    case 'partly_received':
      return {
        variant: 'warning',
        title: 'The hotspot has not confirmed everything sent',
        body: `Check the history below. Call ${contact ?? 'the hotspot manager'} if something went missing, or send more.`,
      };
    case 'fulfilled':
      return {
        variant: 'success',
        title: `${report.hot_spot.name} has what it asked for`,
        body: `${subject} confirmed what arrived for each type requested. Nothing more is needed.`,
      };
  }
}

/** Reports, stock sent and receipts, newest first. Amounts are single pieces. */
function History({ report }: { report: StockoutDetail }) {
  const entries: (ActivityEntry & { at: string })[] = [];
  for (const event of report.events) {
    if (event.action === 'delivered') continue; // Shown from the deliveries, with products.
    const comment = event.data?.comment?.trim();
    const quoted = comment ? ` — “${comment}”` : '';
    const text =
      event.action === 'raised'
        ? `Reported out of ${selectionLabel(event.selection)}${quoted}`
        : event.action === 'selection_changed'
          ? `Reported again, now out of ${selectionLabel(event.selection)}${quoted}`
          : event.action === 'repeated'
            ? `Reported again${quoted}`
            : event.action === 'acknowledged'
              ? `Confirmed ${formatNumber((event.data?.lines ?? []).reduce((sum, line) => sum + line.pieces, 0))} pieces received`
              : event.action === 'rejected'
                ? `Rejected the request${event.data?.reason ? ` — “${event.data.reason}”` : ''}`
                : event.action;
    const byDistrict = event.action === 'rejected';
    entries.push({
      id: event.id,
      at: event.created_at,
      text,
      meta: `${byDistrict ? report.rejected_by?.trim() || 'District store' : 'Hotspot'} · ${formatTimestamp(event.created_at)}`,
      role: byDistrict ? 'dcfp' : 'hotspot-manager',
    });
  }
  if (report.events.length === 0) {
    entries.push({
      id: 'reported',
      at: report.created_at,
      text: `Reported out of ${report.product}${report.comment ? ` — “${report.comment}”` : ''}`,
      meta: `${report.reported_by} · ${formatTimestamp(report.created_at)}`,
      role: 'hotspot-manager',
    });
  }
  for (const delivery of report.deliveries) {
    entries.push({
      id: delivery.id,
      at: delivery.created_at,
      text: (
        <div className="flex flex-col gap-1">
          <span>
            Sent {formatNumber(delivery.lines.reduce((sum, line) => sum + line.pieces, 0))} pieces
          </span>
          <ul className="text-muted-foreground text-xs">
            {delivery.lines.map((line) => (
              <li key={line.id}>
                {line.product}: {formatNumber(line.pieces)} sent ·{' '}
                {line.acknowledged_at === null ? (
                  'awaiting confirmation'
                ) : (line.acknowledged_pieces ?? 0) < line.pieces ? (
                  <span className="text-warning">
                    {formatNumber(line.acknowledged_pieces ?? 0)} received
                  </span>
                ) : (
                  `${formatNumber(line.acknowledged_pieces ?? 0)} received`
                )}
              </li>
            ))}
          </ul>
          {delivery.rider ? (
            <span className="text-muted-foreground text-xs">
              Carried by {delivery.rider.name}
              {delivery.rider.phone ? ` · ${delivery.rider.phone}` : ''}
            </span>
          ) : null}
          {delivery.note ? (
            <span className="text-muted-foreground text-xs">Note: {delivery.note}</span>
          ) : null}
        </div>
      ),
      meta: `District store · ${formatTimestamp(delivery.created_at)}`,
      role: 'dcfp',
    });
  }
  entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
        <CardDescription>
          Reports from the hotspot, stock sent or the rejection, and what it confirmed, in single
          pieces.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActivityTimeline entries={entries} className="wrap-anywhere" />
      </CardContent>
    </Card>
  );
}

function selectionLabel(selection: string): string {
  if (selection === 'both') return 'male and female condoms';
  return `${selection} condoms`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

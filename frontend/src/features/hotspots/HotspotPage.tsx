'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  ActivityTimeline,
  ActivityTimelineSkeleton,
  type ActivityRole,
} from '@/components/ActivityTimeline';
import { DetailHeader } from '@/components/DetailHeader';
import { AuditHistoryLink } from '@/features/audit/links';
import { DetailList } from '@/components/DetailList';
import { TextareaField } from '@/components/form/TextareaField';
import { RecordView } from '@/components/RecordView';
import { ErrorState } from '@/components/states/ErrorState';
import { StatusBadge } from '@/components/StatusBadge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { WriteAction } from '@/components/WriteAction';
import { useCurrentUser } from '@/features/auth/hooks';
import { DCFP_PATHS } from '@/features/dcfp/orders';
import { getErrorMessage } from '@/lib/api';
import { formatText, formatTimestamp } from '@/lib/format';

import {
  DECISIONS_FROM,
  type HotspotComment,
  type HotspotDecision,
  type HotspotDetail,
  type HotspotEvent,
} from './api';
import { DECISION_TEXT, DecisionDialog } from './HotspotDecisionDialog';
import { dispenserSummary, hotspotLabel } from './hotspotForm';
import { useCommentOnHotspot, useHotspot, useHotspotEvents } from './queries';

export default function HotspotPage() {
  const { id } = useParams<{ id: string }>();
  const hotspot = useHotspot(id);
  return (
    <RecordView
      query={hotspot}
      layout="detail"
      noun="hotspot"
      back={{ href: DCFP_PATHS.hotspots, label: 'Back to the hotspots' }}
    >
      {(data) => <HotspotView hotspot={data} />}
    </RecordView>
  );
}

/** Who took a step on a hotspot, as far as the client can tell: names are not available. */
function whoOf(
  userId: string | null,
  me: string | null,
  hotspot: HotspotDetail,
  isDecision: boolean,
): { who: string; role: ActivityRole } {
  if (userId !== null && userId === me) return { who: 'You', role: 'dcfp' };
  if (userId !== null && userId === hotspot.submitted_by_id)
    return { who: 'The VHT who submitted it', role: 'vht' };
  if (isDecision) return { who: 'District focal person', role: 'dcfp' };
  return { who: 'Another user', role: 'system' };
}

const EVENT_TEXT: Record<string, string> = {
  submitted: 'Submitted for review',
  updated: 'Details updated',
  resubmitted: 'Resubmitted for review',
  commented: 'Comment added',
  activated: 'Activated',
  deactivated: 'Deactivated',
  rejected: 'Rejected',
};
const DECISIONS = new Set(['activated', 'deactivated', 'rejected']);

const COMMENT_LABEL: Record<HotspotComment['action'], string> = {
  comment: 'Comment',
  activated: 'Activated',
  deactivated: 'Deactivated',
  rejected: 'Rejected',
};

function HotspotView({ hotspot }: { hotspot: HotspotDetail }) {
  const now = new Date();
  const me = useCurrentUser()?.id ?? null;
  const events = useHotspotEvents(hotspot.id);
  const [deciding, setDeciding] = useState<HotspotDecision | null>(null);
  const decisions = DECISIONS_FROM[hotspot.review_status];
  const place = [hotspot.village, hotspot.subcounty?.name, hotspot.district?.name]
    .filter(Boolean)
    .join(', ');

  const thread = [...hotspot.comments]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((comment) => {
      const { who, role } = whoOf(comment.user_id, me, hotspot, comment.action !== 'comment');
      return {
        id: comment.id,
        text: <span className="wrap-anywhere whitespace-pre-line">{comment.comment}</span>,
        meta: `${COMMENT_LABEL[comment.action]} · ${who} · ${formatTimestamp(comment.created_at, now)}`,
        role,
      };
    });

  const history = (list: readonly HotspotEvent[]) =>
    [...list]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((event) => {
        const { who, role } = whoOf(event.actor_id, me, hotspot, DECISIONS.has(event.action));
        return {
          id: event.id,
          text: EVENT_TEXT[event.action] ?? event.action,
          meta: `${who} · ${formatTimestamp(event.created_at, now)}`,
          role,
        };
      });

  return (
    <div className="gap-section flex flex-col">
      <DetailHeader
        title={hotspotLabel(hotspot)}
        status={<StatusBadge status={hotspot.review_status} />}
        description={`${formatText(hotspot.type)} · ${place || 'Place not recorded'} · submitted ${formatTimestamp(hotspot.created_at, now)}`}
        actions={
          <>
            <AuditHistoryLink subject={{ type: 'hotspot', id: hotspot.id }} />
            {decisions.length > 0 ? (
              <WriteAction>
                {decisions.map((decision) => {
                  const text = DECISION_TEXT[decision];
                  const Icon = text.icon;
                  return (
                    <Button
                      key={decision}
                      variant={text.destructive ? 'outline' : 'default'}
                      onClick={() => {
                        setDeciding(decision);
                      }}
                    >
                      <Icon data-icon="inline-start" />
                      {text.verb}
                    </Button>
                  );
                })}
              </WriteAction>
            ) : null}
          </>
        }
      />

      <div className="gap-section grid lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="gap-section flex min-w-0 flex-col">
          <Card>
            <CardHeader>
              <CardTitle>Comments</CardTitle>
              <CardDescription>
                The conversation with the VHT, and the reason given with each decision.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {thread.length === 0 ? (
                <p className="text-muted-foreground text-sm">No comments yet.</p>
              ) : (
                <ActivityTimeline entries={thread} />
              )}
              <WriteAction>
                <CommentForm hotspotId={hotspot.id} />
              </WriteAction>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              {events.error ? (
                <ErrorState
                  title="Could not load the history"
                  error={events.error}
                  onRetry={() => void events.refetch()}
                  isRetrying={events.isRefetching}
                />
              ) : events.isPending ? (
                <ActivityTimelineSkeleton />
              ) : (
                <ActivityTimeline entries={history(events.data)} />
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                { label: 'Type of place', value: formatText(hotspot.type) },
                { label: 'Region', value: formatText(hotspot.region?.name) },
                { label: 'District', value: formatText(hotspot.district?.name) },
                { label: 'Subcounty', value: formatText(hotspot.subcounty?.name) },
                { label: 'Village', value: formatText(hotspot.village) },
                {
                  label: 'Location',
                  value:
                    hotspot.latitude !== null && hotspot.longitude !== null
                      ? `${String(hotspot.latitude)}, ${String(hotspot.longitude)}`
                      : '—',
                },
                { label: 'Hotspot manager', value: formatText(hotspot.contact_person?.name) },
                {
                  label: "Manager's phone",
                  value: hotspot.contact_person?.phone_number ? (
                    <a
                      href={`tel:${hotspot.contact_person.phone_number}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {hotspot.contact_person.phone_number}
                    </a>
                  ) : (
                    '—'
                  ),
                },
                { label: 'Condom dispenser', value: dispenserSummary(hotspot) },
                { label: 'In use', value: hotspot.status === 'active' ? 'Yes' : 'No' },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      {deciding ? (
        <DecisionDialog
          hotspot={hotspot}
          decision={deciding}
          onClose={() => {
            setDeciding(null);
          }}
        />
      ) : null}
    </div>
  );
}

const commentSchema = z.object({
  comment: z
    .string()
    .trim()
    .min(1, 'Write a comment first.')
    .max(2000, 'Use at most 2000 characters.'),
});

/** Adds a comment to the hotspot's thread without deciding anything. */
function CommentForm({ hotspotId }: { hotspotId: string }) {
  const comment = useCommentOnHotspot(hotspotId);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<z.input<typeof commentSchema>, unknown, z.output<typeof commentSchema>>({
    resolver: zodResolver(commentSchema),
    defaultValues: { comment: '' },
  });
  return (
    <form
      noValidate
      aria-label="Add a comment"
      className="flex flex-col gap-3"
      onSubmit={handleSubmit((values) => {
        comment.mutate(values.comment, {
          onSuccess: () => {
            reset();
          },
        });
      })}
    >
      {comment.error ? (
        <Alert variant="destructive">
          <AlertDescription>{getErrorMessage(comment.error)}</AlertDescription>
        </Alert>
      ) : null}
      <TextareaField
        label="Add a comment"
        required
        description="The VHT who submitted the hotspot sees it."
        error={errors.comment?.message}
        {...register('comment')}
      />
      <div>
        <Button type="submit" variant="outline" disabled={comment.isPending}>
          {comment.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
          {comment.isPending ? 'Adding…' : 'Add comment'}
        </Button>
      </div>
    </form>
  );
}

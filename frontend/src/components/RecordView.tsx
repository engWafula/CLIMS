'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import { SearchX } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { PageSkeleton, type PageSkeletonLayout } from '@/components/states/PageSkeleton';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ApiError } from '@/lib/api';

interface RecordViewProps<Data> {
  query: UseQueryResult<Data, ApiError>;
  layout: PageSkeletonLayout;
  /** The kind of record, e.g. "order", for the messages. */
  noun: string;
  /** Where to go when the record does not exist. */
  back: { href: string; label: string };
  children: (data: Data) => ReactNode;
}

/**
 * The loading, missing and failed states of a page about one record, and the
 * page itself once the record has loaded. Domain-agnostic: give it any
 * `useApiQuery` result for a single record.
 *
 * - loading: the `layout` skeleton;
 * - 404 (`not_found`): "That <noun> isn't available" with a link back to `back.href`;
 * - any other failure: "Could not load this <noun>" with a retry that refetches;
 * - success: `children(data)`.
 *
 * ```tsx
 * <RecordView query={useOrder(id)} layout="detail" noun="order"
 *   back={{ href: '/dcfp/orders', label: 'Back to orders' }}>
 *   {(order) => <OrderDetail order={order} />}
 * </RecordView>
 * ```
 */
export function RecordView<Data>({ query, layout, noun, back, children }: RecordViewProps<Data>) {
  if (query.isPending) return <PageSkeleton layout={layout} />;
  const canKeepData =
    query.data !== undefined &&
    query.isRefetchError &&
    ['network', 'timeout', 'server'].includes(query.error.kind);
  if (query.isError && !canKeepData) {
    if (query.error.kind === 'not_found') {
      return (
        <div className="bg-card rounded-card border">
          <EmptyState
            icon={SearchX}
            title={`That ${noun} isn't available`}
            description="It may have been removed, or the link may be wrong."
            action={
              <Button asChild variant="outline">
                <Link href={back.href}>{back.label}</Link>
              </Button>
            }
          />
        </div>
      );
    }
    return (
      <div className="bg-card rounded-card border">
        <ErrorState
          title={`Could not load this ${noun}`}
          error={query.error}
          onRetry={() => void query.refetch()}
          isRetrying={query.isRefetching}
        />
      </div>
    );
  }
  return (
    <>
      {canKeepData ? (
        <Alert variant="warning">
          <AlertTitle>Could not refresh this {noun}</AlertTitle>
          <AlertDescription>
            Showing the last loaded information.{' '}
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 underline"
              onClick={() => void query.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {children(query.data)}
    </>
  );
}

import { CircleCheck } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/format';
import type { StatusTone } from '@/lib/status';
import { cn } from '@/lib/utils';

export interface TaskItem {
  id: string;
  /** Where the record behind the task stands, e.g. "In queue". */
  status: { label: string; tone: StatusTone };
  title: string;
  /** One line of detail under the title. */
  detail: string;
  /** The button's words, e.g. "Review order". */
  action: string;
  href: string;
}

interface TaskListProps {
  /** The card heading, e.g. "Needs your action". */
  title: string;
  /** In the order they need doing. Undefined while loading or after a failure. */
  tasks: readonly TaskItem[] | undefined;
  isLoading?: boolean;
  error?: unknown;
  /** E.g. "Could not load your tasks". */
  errorTitle: string;
  onRetry?: () => void;
  isRetrying?: boolean;
  /** Read out while loading, e.g. "Loading tasks…". */
  loadingLabel: string;
  /** What to say when nothing is waiting. */
  empty: { title: string; description?: string };
  /** Layout adjustments only. */
  className?: string;
}

/**
 * A dashboard's to-do list: each task with its status, a line of detail and
 * a button to the page where it is done, plus a count in the heading. Shows
 * its own loading, failed and empty states.
 *
 * ```tsx
 * <TaskList title="Needs your action" tasks={tasks} isLoading={isPending} error={error}
 *   errorTitle="Could not load your tasks" onRetry={refetch} loadingLabel="Loading tasks…"
 *   empty={{ title: 'Nothing needs you right now' }} />
 * ```
 */
export function TaskList({
  title,
  tasks,
  isLoading = false,
  error,
  errorTitle,
  onRetry,
  isRetrying,
  loadingLabel,
  empty,
  className,
}: TaskListProps) {
  const hasFailed = error !== undefined && error !== null;
  return (
    <Card className={cn('min-w-0 gap-0 py-0', className)}>
      <CardHeader className="border-b py-3">
        <CardTitle className="flex items-center gap-2">
          {title}
          {tasks && !isLoading && !hasFailed ? (
            <span className="bg-secondary text-muted-foreground rounded-full px-2 py-0.5 text-xs tabular-nums">
              {formatNumber(tasks.length)}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      {hasFailed ? (
        <ErrorState title={errorTitle} error={error} onRetry={onRetry} isRetrying={isRetrying} />
      ) : isLoading || !tasks ? (
        <div className="flex flex-col gap-2 p-4" role="status">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <span className="sr-only">{loadingLabel}</span>
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState icon={CircleCheck} title={empty.title} description={empty.description} />
      ) : (
        // Laid out by the list's own width, not the window's: in a narrow column the status sits
        // above the task, and on a phone the button drops under it.
        <ol
          className="@container divide-y"
          aria-label={title}
          // PDF reports print the list as a table.
          data-pdf-table={JSON.stringify({
            title,
            columns: ['Status', 'What', 'Detail'],
            rows: tasks.map((task) => [task.status.label, task.title, task.detail]),
          })}
        >
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex flex-col gap-2 px-4 py-2.5 @2xl:flex-row @2xl:items-center @2xl:gap-3"
            >
              <StatusBadge
                status={task.status.label}
                tone={task.status.tone}
                className="self-start @2xl:self-center"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2 @sm:flex-row @sm:items-center @sm:gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium break-words">{task.title}</p>
                  <p className="text-muted-foreground text-xs break-words">{task.detail}</p>
                </div>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="shrink-0 self-start @sm:self-center"
                >
                  <Link href={task.href}>{task.action}</Link>
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

import Image from 'next/image';

import mohSeal from '@/assets/moh-seal.png';
import { PageSkeleton } from '@/components/states/PageSkeleton';
import { Skeleton } from '@/components/ui/skeleton';
import { findScreen, locate } from '@/navigation/navigation';
import { PUBLIC_PATHS } from '@/navigation/paths';
import { workspaces } from '@/navigation/workspaces';

/** The signed-in frame, before the session and sidebar preference are available. */
function AppFrameSkeleton({ pathname }: { pathname: string }) {
  const screen = findScreen(workspaces, pathname);
  const location = locate(workspaces, pathname);

  return (
    <div className="flex min-h-svh flex-col">
      <div className="bg-card h-header flex shrink-0 items-center gap-3 border-b px-4">
        <Skeleton className="size-8 shrink-0 rounded-lg" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Image src={mohSeal} alt="" width={28} height={28} className="size-7 shrink-0" />
          <span className="text-base font-bold tracking-tight">CLIMS</span>
          <span className="bg-border mx-1 hidden h-4 w-px sm:block" />
          <span className="text-muted-foreground hidden truncate text-sm sm:block">
            Ministry of Health · Uganda
          </span>
        </div>
        <Skeleton className="size-8 shrink-0 rounded-lg" />
        <Skeleton className="size-8 shrink-0 rounded-lg" />
        <div className="flex items-center gap-2 border-l pl-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <Skeleton className="hidden h-3 w-20 sm:block" />
        </div>
      </div>
      <div className="flex flex-1">
        <div className="bg-sidebar hidden w-56 shrink-0 flex-col border-r px-3 py-4 md:flex">
          {[0, 1, 2].map((group) => (
            <div key={group} className="mb-6 flex flex-col gap-2">
              <Skeleton className="ml-2 h-2 w-16 rounded-full" />
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex h-8 items-center gap-2.5 px-2">
                  <Skeleton className="size-4 shrink-0 rounded" />
                  <Skeleton className={row === 1 ? 'h-3 w-20' : 'h-3 w-28'} />
                </div>
              ))}
            </div>
          ))}
          <div className="mt-auto flex items-center gap-2 border-t pt-3">
            <Skeleton className="size-8 shrink-0 rounded-lg" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-2 w-16" />
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
        </div>
        <div className="bg-canvas min-w-0 flex-1">
          <div className="bg-card border-b px-4 pt-2.5 pb-2.5">
            {location.detail && location.item ? (
              <div className="text-muted-foreground mb-0.5 text-[0.8125rem] font-medium">
                ‹ Back to {location.item.label}
              </div>
            ) : null}
            {screen ? (
              <div className="text-lg leading-snug font-semibold tracking-tight">
                {screen.title}
              </div>
            ) : (
              <Skeleton className="my-1 h-5 w-40" />
            )}
            {location.page?.description ? <Skeleton className="mt-1 h-3 w-72 max-w-full" /> : null}
            {location.page && location.item && location.item.pages.length > 1 ? (
              <div className="mt-3 flex gap-5 pb-1">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            ) : null}
          </div>
          <div className="w-full px-4 pt-3 pb-8">
            <PageSkeleton layout={screen?.layout ?? 'table'} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** A quiet, signed-out frame while an authentication page starts. */
function PublicPageSkeleton() {
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <div className="flex items-center gap-3">
          <Image src={mohSeal} alt="" width={44} height={44} className="size-11" />
          <span className="text-lg font-semibold">CLIMS</span>
        </div>
        <div className="flex w-full flex-col items-center gap-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-3 w-48" />
        </div>
        <div className="bg-card rounded-card flex w-full flex-col gap-4 border p-5 sm:p-6">
          {[0, 1].map((field) => (
            <div key={field} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-8 w-full rounded-lg" />
            </div>
          ))}
          <Skeleton className="h-8 w-full rounded-lg" />
        </div>
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  );
}

/** The route-shaped placeholder used before the browser can restore the session. */
export function PageLoader({ pathname }: { pathname?: string }) {
  const path = pathname?.split(/[?#]/)[0];
  const isPublic = !path || PUBLIC_PATHS.includes(path);

  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading page…</span>
      <div aria-hidden="true">
        {isPublic ? <PublicPageSkeleton /> : <AppFrameSkeleton pathname={path} />}
      </div>
    </div>
  );
}

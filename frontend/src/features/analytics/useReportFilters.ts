'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

import {
  EMPTY_FILTERS,
  filterQuery,
  readFilters,
  resolveInterval,
  resolvePeriod,
  type Period,
  type ReportFilterState,
} from './filters';

export interface ReportFilters {
  state: ReportFilterState;
  /** The calendar days the filters cover. */
  period: Period;
  interval: 'day' | 'week' | 'month';
  /** Changes some filters, keeping the rest and the address's other parameters. */
  update: (changes: Partial<ReportFilterState>) => void;
  /** Back to the defaults (the period and interval too). */
  reset: () => void;
}

/** Address parameters that belong to the page, not the filters (e.g. the chosen report). */
const PAGE_PARAMS = ['view', 'version', 'store'];

/**
 * The page's report filters, read from and written to its address with
 * `router.replace`, so they survive a refresh, can be shared, and do not fill
 * the history with every slicer change.
 */
export function useReportFilters(): ReportFilters {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const state = useMemo(() => readFilters(params), [params]);
  const period = useMemo(() => resolvePeriod(state), [state]);
  const interval = resolveInterval(state, period);

  const write = useCallback(
    (next: ReportFilterState) => {
      const keep = Object.fromEntries(PAGE_PARAMS.map((key) => [key, params.get(key) ?? '']));
      router.replace(`${pathname}${filterQuery(next, keep)}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const update = useCallback(
    (changes: Partial<ReportFilterState>) => {
      const next = { ...state, ...changes };
      // Choosing a preset clears custom dates; typing a date switches to custom.
      if (changes.preset && changes.preset !== 'custom') Object.assign(next, { from: '', to: '' });
      if (changes.from !== undefined || changes.to !== undefined) next.preset = 'custom';
      // A district outside the chosen region would leave the reports empty.
      if (changes.regionId !== undefined && changes.regionId !== state.regionId)
        next.districtId = '';
      write(next);
    },
    [state, write],
  );

  const reset = useCallback(() => {
    write(EMPTY_FILTERS);
  }, [write]);

  return { state, period, interval, update, reset };
}

/*
 * The report filters every dashboard and report shares, kept in the page
 * address so a filtered view survives a refresh and can be shared. Periods are
 * Kampala calendar days (both ends included), as the API reads them (RN09).
 */

export const PERIOD_PRESETS = [
  'this-month',
  'last-month',
  'last-3-months',
  'last-6-months',
  'last-12-months',
  'this-quarter',
  'year-to-date',
  'custom',
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  'this-month': 'This month',
  'last-month': 'Last month',
  'last-3-months': 'Last 3 months',
  'last-6-months': 'Last 6 months',
  'last-12-months': 'Last 12 months',
  'this-quarter': 'This quarter',
  'year-to-date': 'Year to date',
  custom: 'Custom dates',
};

export const DEFAULT_PRESET: PeriodPreset = 'last-3-months';

export const INTERVALS = ['auto', 'day', 'week', 'month'] as const;
export type Interval = (typeof INTERVALS)[number];
export const INTERVAL_LABELS: Record<Interval, string> = {
  auto: 'Automatic',
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
};

export const CATEGORIES = ['male', 'female'] as const;
export type Category = (typeof CATEGORIES)[number];

/** The filters a page can offer; each page picks the ones its reports read. */
export type FilterField =
  | 'period'
  | 'interval'
  | 'region'
  | 'district'
  | 'warehouse'
  | 'storeType'
  | 'category'
  | 'status'
  | 'band'
  | 'month';

export interface ReportFilterState {
  preset: PeriodPreset;
  /** Set only with the custom preset. */
  from: string;
  to: string;
  interval: Interval;
  regionId: string;
  districtId: string;
  warehouseId: string;
  storeType: '' | 'national' | 'district';
  category: '' | Category;
  status: string;
  band: string;
  /** YYYY-MM, for the HMIS 105 month. */
  month: string;
}

export const EMPTY_FILTERS: ReportFilterState = {
  preset: DEFAULT_PRESET,
  from: '',
  to: '',
  interval: 'auto',
  regionId: '',
  districtId: '',
  warehouseId: '',
  storeType: '',
  category: '',
  status: '',
  band: '',
  month: '',
};

/** Address parameter of each filter. */
export const PARAM: Record<keyof ReportFilterState, string> = {
  preset: 'period',
  from: 'from',
  to: 'to',
  interval: 'interval',
  regionId: 'region_id',
  districtId: 'district_id',
  warehouseId: 'warehouse_store_id',
  storeType: 'store_type',
  category: 'category',
  status: 'status',
  band: 'band',
  month: 'month',
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

function oneOf<T extends string>(values: readonly T[], raw: string | null, fallback: T): T {
  return values.includes(raw as T) ? (raw as T) : fallback;
}

/** Reads the filters from the address, ignoring anything malformed. */
export function readFilters(params: { get: (key: string) => string | null }): ReportFilterState {
  const text = (key: keyof ReportFilterState) => params.get(PARAM[key])?.trim() ?? '';
  const from = text('from');
  const to = text('to');
  const hasDates = DATE.test(from) || DATE.test(to);
  return {
    preset: hasDates ? 'custom' : oneOf(PERIOD_PRESETS, params.get(PARAM.preset), DEFAULT_PRESET),
    from: DATE.test(from) ? from : '',
    to: DATE.test(to) ? to : '',
    interval: oneOf(INTERVALS, params.get(PARAM.interval), 'auto'),
    regionId: text('regionId'),
    districtId: text('districtId'),
    warehouseId: text('warehouseId'),
    storeType: oneOf(['', 'national', 'district'] as const, params.get(PARAM.storeType), ''),
    category: oneOf(['', 'male', 'female'] as const, params.get(PARAM.category), ''),
    status: text('status'),
    band: text('band'),
    month: MONTH.test(text('month')) ? text('month') : '',
  };
}

/** The address query for `state`, leaving out defaults so addresses stay short. */
export function filterQuery(state: ReportFilterState, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
  if (state.preset === 'custom') {
    if (state.from) params.set(PARAM.from, state.from);
    if (state.to) params.set(PARAM.to, state.to);
    if (!state.from && !state.to) params.set(PARAM.preset, 'custom');
  } else if (state.preset !== DEFAULT_PRESET) {
    params.set(PARAM.preset, state.preset);
  }
  if (state.interval !== 'auto') params.set(PARAM.interval, state.interval);
  for (const key of [
    'regionId',
    'districtId',
    'warehouseId',
    'storeType',
    'category',
    'status',
    'band',
    'month',
  ] as const) {
    if (state[key]) params.set(PARAM[key], state[key]);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** Today in Kampala as YYYY-MM-DD. */
export function kampalaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kampala',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function ymd(year: number, month: number, day: number): string {
  // Date.UTC normalises overflowing months and days (month 0 of next year, day 0 = last of before).
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

export interface Period {
  from: string;
  to: string;
}

/** The calendar days a preset covers, ending today (or ending last month, for last month). */
export function resolvePeriod(state: ReportFilterState, today: string = kampalaToday()): Period {
  const [year = 2026, month1 = 1] = today.split('-').map(Number);
  const month = month1 - 1;
  switch (state.preset) {
    case 'this-month':
      return { from: ymd(year, month, 1), to: today };
    case 'last-month':
      return { from: ymd(year, month - 1, 1), to: ymd(year, month, 0) };
    case 'last-3-months':
      return { from: ymd(year, month - 2, 1), to: today };
    case 'last-6-months':
      return { from: ymd(year, month - 5, 1), to: today };
    case 'last-12-months':
      return { from: ymd(year, month - 11, 1), to: today };
    case 'this-quarter':
      return { from: ymd(year, month - (month % 3), 1), to: today };
    case 'year-to-date':
      return { from: ymd(year, 0, 1), to: today };
    case 'custom': {
      const to = state.to || today;
      const from = state.from || ymd(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, 1);
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

/** The interval a trend uses: the chosen one, or days up to a month, weeks up to a quarter, else months. */
export function resolveInterval(
  state: ReportFilterState,
  period: Period,
): Exclude<Interval, 'auto'> {
  if (state.interval !== 'auto') return state.interval;
  const days = (Date.parse(period.to) - Date.parse(period.from)) / 86_400_000 + 1;
  return days <= 31 ? 'day' : days <= 92 ? 'week' : 'month';
}

/** Which API parameters a report reads. */
export type ApiParam =
  | 'from'
  | 'to'
  | 'interval'
  | 'region_id'
  | 'district_id'
  | 'warehouse_store_id'
  | 'store_type'
  | 'category'
  | 'status'
  | 'band'
  | 'month';

/** The API query parameters for `state`, limited to `accepted`; unset filters are left out. */
export function apiParams(
  state: ReportFilterState,
  accepted: readonly ApiParam[],
  today: string = kampalaToday(),
): Record<string, string> {
  const period = resolvePeriod(state, today);
  const all: Record<ApiParam, string> = {
    from: period.from,
    to: period.to,
    interval: resolveInterval(state, period),
    region_id: state.regionId,
    district_id: state.districtId,
    warehouse_store_id: state.warehouseId,
    store_type: state.storeType,
    category: state.category,
    status: state.status,
    band: state.band,
    month: state.month || today.slice(0, 7),
  };
  return Object.fromEntries(accepted.filter((key) => all[key]).map((key) => [key, all[key]]));
}

/** A period in words: "1 Sep – 24 Nov 2026". */
export function periodLabel(period: Period): string {
  const format = (day: string, withYear: boolean) =>
    new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    }).format(new Date(`${day}T00:00:00Z`));
  if (period.from === period.to) return format(period.from, true);
  const sameYear = period.from.slice(0, 4) === period.to.slice(0, 4);
  return `${format(period.from, !sameYear)} – ${format(period.to, true)}`;
}

/** A trend bucket's start as a short label: "Nov 2026" (month), "3 Nov" (week or day). */
export function bucketLabel(start: string, interval: Exclude<Interval, 'auto'>): string {
  const date = new Date(`${start}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    ...(interval === 'month'
      ? { month: 'short', year: 'numeric' }
      : { day: 'numeric', month: 'short' }),
  }).format(date);
}

import { describe, expect, it } from 'vitest';

import {
  apiParams,
  bucketLabel,
  EMPTY_FILTERS,
  filterQuery,
  periodLabel,
  readFilters,
  resolveInterval,
  resolvePeriod,
  type ReportFilterState,
} from './filters';

const TODAY = '2026-11-24';
const state = (changes: Partial<ReportFilterState>) => ({ ...EMPTY_FILTERS, ...changes });
const params = (query: string) => new URLSearchParams(query);

describe('report filters', () => {
  it('resolves each period preset to Kampala calendar days ending today', () => {
    expect(resolvePeriod(state({ preset: 'this-month' }), TODAY)).toEqual({
      from: '2026-11-01',
      to: TODAY,
    });
    expect(resolvePeriod(state({ preset: 'last-month' }), TODAY)).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(resolvePeriod(state({ preset: 'last-3-months' }), TODAY)).toEqual({
      from: '2026-09-01',
      to: TODAY,
    });
    expect(resolvePeriod(state({ preset: 'last-12-months' }), TODAY)).toEqual({
      from: '2025-12-01',
      to: TODAY,
    });
    expect(resolvePeriod(state({ preset: 'this-quarter' }), TODAY)).toEqual({
      from: '2026-10-01',
      to: TODAY,
    });
    expect(resolvePeriod(state({ preset: 'year-to-date' }), TODAY)).toEqual({
      from: '2026-01-01',
      to: TODAY,
    });
    // January's last month is December of the year before.
    expect(resolvePeriod(state({ preset: 'last-month' }), '2027-01-15')).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
  });

  it('takes custom dates, defaults the missing end, and puts reversed dates in order', () => {
    expect(resolvePeriod(state({ preset: 'custom', from: '2026-07-01', to: '' }), TODAY)).toEqual({
      from: '2026-07-01',
      to: TODAY,
    });
    expect(resolvePeriod(state({ preset: 'custom', from: '', to: '2026-06-20' }), TODAY)).toEqual({
      from: '2026-06-01',
      to: '2026-06-20',
    });
    expect(
      resolvePeriod(state({ preset: 'custom', from: '2026-08-10', to: '2026-08-01' }), TODAY),
    ).toEqual({ from: '2026-08-01', to: '2026-08-10' });
  });

  it('widens the interval with the period unless one is chosen', () => {
    expect(resolveInterval(state({}), { from: '2026-11-01', to: '2026-11-24' })).toBe('day');
    expect(resolveInterval(state({}), { from: '2026-09-01', to: '2026-11-24' })).toBe('week');
    expect(resolveInterval(state({}), { from: '2025-12-01', to: '2026-11-24' })).toBe('month');
    expect(
      resolveInterval(state({ interval: 'month' }), { from: '2026-11-01', to: '2026-11-24' }),
    ).toBe('month');
  });

  it('round-trips through the address, leaving defaults out and keeping page parameters', () => {
    const read = readFilters(params('period=last-month&district_id=d1&category=male&view=stock'));
    expect(read).toMatchObject({ preset: 'last-month', districtId: 'd1', category: 'male' });
    expect(filterQuery(read, { view: 'stock' })).toBe(
      '?view=stock&period=last-month&district_id=d1&category=male',
    );
    expect(filterQuery(EMPTY_FILTERS)).toBe('');
  });

  it('ignores malformed values in the address', () => {
    const read = readFilters(
      params('period=forever&category=both&from=yesterday&interval=hourly&month=2026-13x'),
    );
    expect(read).toMatchObject({
      preset: 'last-3-months',
      category: '',
      from: '',
      interval: 'auto',
      month: '',
    });
  });

  it('switches to custom dates when the address has them', () => {
    expect(readFilters(params('from=2026-10-01&to=2026-10-15')).preset).toBe('custom');
  });

  it('sends only the parameters a report reads, and only those set', () => {
    const filters = state({ districtId: 'd1', category: 'female', band: 'expired' });
    expect(apiParams(filters, ['from', 'to', 'district_id', 'category'], TODAY)).toEqual({
      from: '2026-09-01',
      to: TODAY,
      district_id: 'd1',
      category: 'female',
    });
    expect(apiParams(state({}), ['district_id', 'month', 'interval'], TODAY)).toEqual({
      month: '2026-11',
      interval: 'week',
    });
  });

  it('labels periods and trend buckets in words', () => {
    expect(periodLabel({ from: '2026-09-01', to: '2026-11-24' })).toBe('1 Sept – 24 Nov 2026');
    expect(periodLabel({ from: '2025-12-01', to: '2026-01-31' })).toBe('1 Dec 2025 – 31 Jan 2026');
    expect(bucketLabel('2026-11-01', 'month')).toBe('Nov 2026');
    expect(bucketLabel('2026-11-02', 'week')).toBe('2 Nov');
  });
});

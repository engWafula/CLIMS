import { describe, expect, it } from 'vitest';

import { aProductSummary, aStoreSummary } from '@/test/warehouseOrderFixtures';

import {
  dispatchBreakdown,
  formatAmounts,
  formatDays,
  formatMonths,
  formatPercent,
  formatStock,
  nextExpiry,
  pendingBreakdown,
  pendingOrders,
  periodFrom,
  periodRange,
  productName,
  stockCover,
  successBreakdown,
  successRate,
  totalsByUnit,
} from './summary';

const orders = aStoreSummary().orders;

describe('periods', () => {
  it('reads the period from the address, defaulting to 30 days', () => {
    expect(periodFrom('90d')).toBe('90d');
    expect(periodFrom('forever')).toBe('30d');
    expect(periodFrom(null)).toBe('30d');
  });

  it('counts both ends of the period as days in it', () => {
    expect(periodRange('30d', '2026-11-20')).toEqual({ from: '2026-10-22', to: '2026-11-20' });
    expect(periodRange('12m', '2026-03-01')).toEqual({ from: '2025-03-02', to: '2026-03-01' });
  });
});

describe('amounts', () => {
  const products = [
    aProductSummary({ unit: 'box', on_hand: 900 }),
    aProductSummary({ condom_id: 'p2', unit: 'carton', on_hand: 40 }),
    aProductSummary({ condom_id: 'p3', unit: 'box', on_hand: 100 }),
    aProductSummary({ condom_id: 'p4', unit: 'piece', on_hand: 0 }),
  ];

  it('totals each unit apart, largest first, leaving out units with nothing', () => {
    expect(totalsByUnit(products, (row) => row.on_hand)).toEqual([
      { unit: 'box', quantity: 1000 },
      { unit: 'carton', quantity: 40 },
    ]);
    expect(formatAmounts(totalsByUnit(products, (row) => row.on_hand))).toBe(
      '1,000 box · 40 carton',
    );
  });

  it('says none in the words given', () => {
    expect(formatAmounts([])).toBe('0');
    expect(formatAmounts([], 'None')).toBe('None');
  });

  it('leaves pieces unnamed on the stock screens, naming any other unit', () => {
    expect(formatStock([{ unit: 'Pieces', quantity: 5_499_800 }])).toBe('5,499,800');
    expect(
      formatStock([
        { unit: 'piece', quantity: 1000 },
        { unit: 'Carton', quantity: 40 },
      ]),
    ).toBe('1,000 · 40 Carton');
    expect(formatStock([], 'None')).toBe('None');
    expect(productName('Orange Free Female', 'Pieces')).toBe('Orange Free Female');
    expect(productName('Orange Free Female', 'Box')).toBe('Orange Free Female, Box');
  });
});

describe('orders', () => {
  it('counts what waits on the warehouse, in words', () => {
    expect(pendingOrders(orders)).toBe(3);
    expect(pendingBreakdown(orders)).toBe('2 new · 1 waiting for stock');
    expect(
      pendingBreakdown({ ...orders, to_decide: 0, waiting_for_stock: 0, to_dispatch: 0 }),
    ).toBe('Nothing is waiting on the warehouse');
  });

  it('rates success as dispatched of those dispatched or rejected', () => {
    expect(successRate(orders)).toBe(0.8);
    expect(successBreakdown(orders, '30d')).toBe(
      '4 of 5 orders dispatched · typically 2.4 days to dispatch',
    );
    const none = { ...orders, dispatched: 0, rejected: 0, median_days_to_dispatch: null };
    expect(successRate(none)).toBeNull();
    expect(successBreakdown(none, '90d')).toBe(
      'No orders dispatched or rejected in the last 90 days',
    );
  });

  it('never rounds a rate short of all to 100%', () => {
    expect(formatPercent(0.996)).toBe('99%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(0)).toBe('0%');
  });

  it('says where dispatches went and what is still on the road', () => {
    expect(dispatchBreakdown(orders, '30d')).toBe('4 orders to 3 districts · 1 still in transit');
    expect(
      dispatchBreakdown({ ...orders, dispatched: 1, districts_supplied: 1, in_transit: 0 }, '30d'),
    ).toBe('1 order to 1 district');
    expect(dispatchBreakdown({ ...orders, dispatched: 0 }, '30d')).toBe(
      'None in the last 30 days · 1 order still in transit',
    );
  });

  it('puts durations in plain words', () => {
    expect(formatDays(0.4)).toBe('under a day');
    expect(formatDays(1.02)).toBe('1 day');
    expect(formatDays(2.46)).toBe('2.5 days');
  });
});

describe('stock cover', () => {
  it('is free stock over the average month of the last 90 days of dispatches', () => {
    expect(stockCover(aProductSummary({ usable: 570, dispatched_90_days: 300 }))).toBeCloseTo(5.7);
    expect(stockCover(aProductSummary({ dispatched_90_days: 0 }))).toBeNull();
  });

  it('reads in months, with the ends in words', () => {
    expect(formatMonths(0.5)).toBe('Under a month');
    expect(formatMonths(1)).toBe('1 month');
    expect(formatMonths(5.66)).toBe('5.7 months');
    expect(formatMonths(30)).toBe('Over 2 years');
  });

  it('finds the earliest next expiry across products', () => {
    expect(
      nextExpiry([
        aProductSummary({ next_expiry: '2027-03-01' }),
        aProductSummary({ next_expiry: null }),
        aProductSummary({ next_expiry: '2026-12-08' }),
      ]),
    ).toBe('2026-12-08');
    expect(nextExpiry([aProductSummary({ next_expiry: null })])).toBeNull();
  });
});

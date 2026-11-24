import { formatNumber } from '@/lib/format';

const compact = new Intl.NumberFormat('en-UG', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * An axis tick: in full under 10,000 (2,500), compact above (12K, 1.4M), so a
 * scale reaching millions stays narrow. Values printed on marks use the same.
 */
export function axisNumber(value: number): string {
  return Math.abs(value) < 10_000 ? formatNumber(Math.round(value)) : compact.format(value);
}

/** A percentage to one decimal at most: 66.7%, 100%. */
export function percentLabel(value: number): string {
  return `${formatNumber(Math.round(value * 10) / 10)}%`;
}

/** Hours as a short duration: 45 min, 6.5 h, 3.2 days. */
export function hoursLabel(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${formatNumber(Math.round(hours * 10) / 10)} h`;
  return `${formatNumber(Math.round((hours / 24) * 10) / 10)} days`;
}

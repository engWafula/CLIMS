import type { Hotspot } from './api';

export function hotspotLabel(hotspot: Pick<Hotspot, 'name'>): string {
  return hotspot.name ?? 'Unnamed hotspot';
}

/** "Yes, in good condition" style summary of the dispenser answers. */
export function dispenserSummary(
  hotspot: Pick<Hotspot, 'has_condom_dispenser' | 'dispenser_condition'>,
) {
  if (hotspot.has_condom_dispenser === null) return null;
  if (!hotspot.has_condom_dispenser) return 'No';
  return hotspot.dispenser_condition ? `Yes, ${hotspot.dispenser_condition.toLowerCase()}` : 'Yes';
}

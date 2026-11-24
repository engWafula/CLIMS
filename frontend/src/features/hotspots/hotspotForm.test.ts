import { describe, expect, it } from 'vitest';

import { dispenserSummary } from './hotspotForm';

describe('dispenserSummary', () => {
  it('describes the dispenser answers', () => {
    expect(dispenserSummary({ has_condom_dispenser: null, dispenser_condition: null })).toBeNull();
    expect(dispenserSummary({ has_condom_dispenser: false, dispenser_condition: null })).toBe('No');
    expect(dispenserSummary({ has_condom_dispenser: true, dispenser_condition: 'Poor' })).toBe(
      'Yes, poor',
    );
  });
});

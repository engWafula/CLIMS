import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ChartCard } from './ChartCard';

const series = [
  { key: 'raised', label: 'Raised', color: 'var(--chart-1)' },
  { key: 'fulfilled', label: 'Fulfilled', color: 'var(--chart-2)' },
];
const rows = [
  { label: 'Sep 2026', values: { raised: 3, fulfilled: 2 } },
  { label: 'Oct 2026', values: { raised: 4, fulfilled: null } },
];

function card(props: Partial<React.ComponentProps<typeof ChartCard>> = {}) {
  return (
    <ChartCard
      title="Requests"
      description="Raised and fulfilled."
      series={series}
      rows={rows}
      categoryLabel="Month"
      {...props}
    >
      <p>the chart</p>
    </ChartCard>
  );
}

describe('ChartCard', () => {
  it('names every series in a legend and switches to the same figures as a table', async () => {
    const user = userEvent.setup();
    render(card());
    expect(screen.getByText('the chart')).toBeInTheDocument();
    expect(screen.getByText('Raised')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show Requests as a table' }));
    expect(screen.getByRole('cell', { name: 'Sep 2026' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '—' })).toBeInTheDocument(); // a missing value, not 0
  });

  it('says a failed load failed, never drawing zeros', async () => {
    const user = userEvent.setup();
    let retried = false;
    render(card({ error: new Error('boom'), onRetry: () => (retried = true) }));
    expect(screen.getByText('This chart could not be loaded')).toBeInTheDocument();
    expect(screen.queryByText('the chart')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retried).toBe(true);
    expect(screen.getByRole('button', { name: 'More options for Requests' })).toBeDisabled();
  });

  it('explains an empty chart in its own words', () => {
    render(card({ rows: [], emptyMessage: 'No requests in this period.' }));
    expect(screen.getByText('No requests in this period.')).toBeInTheDocument();
  });

  it('is found by PDF reports by its title', () => {
    const { container } = render(card());
    expect(container.querySelector('[data-visual]')?.getAttribute('data-visual-title')).toBe(
      'Requests',
    );
  });
});

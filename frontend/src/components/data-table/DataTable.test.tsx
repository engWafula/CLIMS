import { render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';

import { DataTable, type DataTableColumn } from './DataTable';

interface Site {
  id: number;
  name: string | null;
  stock: number | null;
}

const columns: DataTableColumn<Site>[] = [
  { id: 'name', header: 'Name', value: (site) => site.name },
  { id: 'stock', header: 'Stock', value: (site) => site.stock, numeric: true },
];

const sites: Site[] = Array.from({ length: 23 }, (_, index) => ({
  id: index + 1,
  name: `Site ${String(index + 1).padStart(2, '0')}`,
  stock: (index * 37) % 100,
}));

function renderTable(props: Partial<Parameters<typeof DataTable<Site>>[0]> = {}) {
  return render(
    <DataTable
      label="Sites"
      columns={columns}
      rows={sites}
      getRowId={(site) => site.id}
      emptyTitle="No sites yet"
      emptyDescription="Add a site to get started."
      {...props}
    />,
  );
}

/** The first-column text of each body row, in display order. */
const names = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent);

describe('DataTable', () => {
  it('shows the first page and how many rows there are in total', () => {
    renderTable();
    expect(names()).toHaveLength(10);
    expect(screen.getByText('Showing 1–10 of 23')).toBeInTheDocument();
  });

  it('moves between pages and disables the ends', async () => {
    const user = userEvent.setup();
    renderTable();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Page 3' }));

    expect(names()).toEqual(['Site 21', 'Site 22', 'Site 23']);
    expect(screen.getByRole('button', { name: 'Page 3' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('filters as the user types and returns to the first page', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole('button', { name: 'Page 2' }));

    await user.type(screen.getByRole('searchbox', { name: 'Search sites' }), 'SITE 02');

    expect(names()).toEqual(['Site 02']);
    expect(screen.getByText('Showing 1–1 of 1')).toBeInTheDocument();
  });

  it('offers to clear a search that matches nothing', async () => {
    const user = userEvent.setup();
    renderTable();

    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('No matches')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(names()).toHaveLength(10);
  });

  it('sorts a column ascending, then descending, then not at all, and says so to assistive tech', async () => {
    const user = userEvent.setup();
    renderTable();
    const header = screen.getByRole('columnheader', { name: /Stock/ });
    const toggle = within(header).getByRole('button');

    await user.click(toggle);
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    expect(names()[0]).toBe('Site 01');

    await user.click(toggle);
    expect(header).toHaveAttribute('aria-sort', 'descending');
    expect(names()[0]).toBe('Site 09');

    await user.click(toggle);
    expect(header).not.toHaveAttribute('aria-sort');
  });

  it('shows the empty state, without a search box, when there are no rows', () => {
    renderTable({ rows: [] });
    expect(screen.getByText('No sites yet')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('shows placeholders, not the empty state, while loading', () => {
    renderTable({ rows: undefined, isLoading: true });
    expect(screen.queryByText('No sites yet')).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Sites' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByRole('row')).toHaveLength(1);
  });

  it('shows a safe error message with a way to retry when loading fails', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderTable({
      rows: undefined,
      error: new ApiError({ kind: 'network', message: 'Could not reach the server.' }),
      onRetry,
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load sites');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the server.');

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps showing rows it already has when a background refresh fails', () => {
    renderTable({ error: new ApiError({ kind: 'server', message: 'Server problem.' }) });
    expect(names()).toHaveLength(10);
    expect(screen.getByRole('status')).toHaveTextContent('Showing the last loaded records.');
  });

  it('renders a dash for missing values and never the text "null"', () => {
    renderTable({ rows: [{ id: 1, name: null, stock: null }] });
    expect(names()).toEqual(['—']);
    expect(screen.queryByText('null')).not.toBeInTheDocument();
  });

  it('renders markup in data as text, not as HTML', () => {
    renderTable({ rows: [{ id: 1, name: '<img src=x onerror=alert(1)>', stock: 1 }] });
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('DataTable selection', () => {
  function Selectable() {
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    return (
      <>
        <DataTable
          label="Sites"
          columns={columns}
          rows={sites}
          getRowId={(site) => site.id}
          emptyTitle="No sites yet"
          selection={{
            selected,
            onChange: setSelected,
            rowLabel: (site) => site.name ?? `Site ${site.id}`,
          }}
        />
        <output>{[...selected].join(',')}</output>
      </>
    );
  }

  /** The ticked ids, as the test harness prints them. */
  const ticked = () => document.querySelector('output')?.textContent ?? '';

  it('ticks rows one by one, and the header ticks or clears the whole page', async () => {
    const user = userEvent.setup();
    render(<Selectable />);

    const first = sites[0];
    if (!first) throw new Error('no sites');
    await user.click(screen.getByRole('checkbox', { name: `Select ${first.name}` }));
    expect(ticked()).toBe(String(first.id));

    const header = screen.getByRole('checkbox', { name: /Select every sites row on this page/ });
    expect(header).toHaveAttribute('aria-checked', 'mixed');
    await user.click(header);
    expect(ticked().split(',')).toHaveLength(10);
    expect(header).toBeChecked();

    await user.click(header);
    expect(ticked()).toBe('');
  });

  it('offers every matching row once the whole page is ticked', async () => {
    const user = userEvent.setup();
    render(<Selectable />);

    await user.click(screen.getByRole('checkbox', { name: /Select every sites row on this page/ }));
    const banner = () => screen.getByText(/rows (on this page )?are selected/).parentElement;
    expect(banner()).toHaveTextContent('All 10 rows on this page are selected.');

    await user.click(screen.getByRole('button', { name: 'Select all 23 rows' }));
    expect(ticked().split(',')).toHaveLength(23);
    expect(banner()).toHaveTextContent('All 23 rows are selected.');

    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(ticked()).toBe('');
  });
});

describe('DataTable totals, details and loading more', () => {
  const withTotal: DataTableColumn<Site>[] = [
    { id: 'name', header: 'Name', value: (site) => site.name },
    {
      id: 'stock',
      header: 'Stock',
      value: (site) => site.stock,
      numeric: true,
      total: (rows) => rows.reduce((sum, site) => sum + (site.stock ?? 0), 0),
    },
  ];

  it('totals every matching row, not just the page showing', async () => {
    const user = userEvent.setup();
    renderTable({ columns: withTotal });
    const all = sites.reduce((sum, site) => sum + (site.stock ?? 0), 0);
    const footer = () => screen.getAllByRole('row').at(-1);
    expect(footer()).toHaveTextContent(`Total of all 23${all}`);

    await user.type(screen.getByRole('searchbox', { name: 'Search sites' }), 'Site 02');
    expect(footer()).toHaveTextContent(`Total of 1 matching${sites[1]?.stock ?? 0}`);
  });

  it('opens a row to show its detail', async () => {
    const user = userEvent.setup();
    renderTable({
      renderExpanded: (site) => <p>Detail of {site.name}</p>,
      expandLabel: (site) => `Show detail of ${site.name}`,
    });
    const toggle = screen.getByRole('button', { name: 'Show detail of Site 01' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Detail of Site 01')).toBeInTheDocument();
    const detail = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(detail).toHaveTextContent('Detail of Site 01');
  });

  it('says the count is partial and loads more when the server holds more', async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    renderTable({ more: { hasMore: true, isLoading: false, onLoadMore, noun: 'sites' } });
    expect(screen.getByText('Showing 1–10 of the 23 sites loaded so far')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Load more sites' }));
    expect(onLoadMore).toHaveBeenCalledOnce();

    await user.type(screen.getByRole('searchbox', { name: 'Search sites' }), 'zzz');
    expect(screen.getByText(/Load more to search further back/)).toBeInTheDocument();
  });

  it('keeps the header in view on a long page', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 120 }, (_, index) => ({
      id: index + 1,
      name: `Site ${index + 1}`,
      stock: index,
    }));
    renderTable({ rows: many });
    const head = () => screen.getAllByRole('rowgroup')[0];
    expect(head()).not.toHaveClass('sticky');

    await user.click(screen.getByRole('button', { name: /View options for sites/ }));
    await user.click(screen.getByRole('menuitemradio', { name: '50' }));

    expect(head()).toHaveClass('sticky');
  });
});

describe('DataTable embedded', () => {
  it('lists every line, with no search, paging or sorting, and marks rows by tone', () => {
    render(
      <DataTable
        variant="embedded"
        label="Batches to pick"
        columns={[
          { id: 'name', header: 'Name', cell: (site) => site.name },
          { id: 'stock', header: 'Stock', value: (site) => site.stock, numeric: true },
        ]}
        rows={sites}
        getRowId={(site) => site.id}
        rowTone={(site) => (site.id === 1 ? 'caution' : 'default')}
      />,
    );
    expect(names()).toHaveLength(23);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Stock/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('row')[1]).toHaveClass('bg-warning/5');
  });

  it('says so in one line when there are no lines', () => {
    render(
      <DataTable
        variant="embedded"
        label="Batches in store"
        columns={columns}
        rows={[]}
        getRowId={(site) => site.id}
        emptyTitle="No stock in the district store."
      />,
    );
    expect(screen.getByRole('cell')).toHaveTextContent('No stock in the district store.');
  });
});

describe('DataTable view menu', () => {
  it('hides and shows columns, and changes rows per page', async () => {
    const user = userEvent.setup();
    const [first, ...rest] = columns;
    if (!first) throw new Error('no columns');
    renderTable({
      preferencesKey: 'sites',
      columns: [first, ...rest.map((column) => ({ ...column, hideable: true }))],
    });

    const hideable = rest[0];
    if (!hideable) throw new Error('need a second column');
    expect(
      screen.getByRole('columnheader', { name: new RegExp(hideable.header) }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /View options for sites/ }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: hideable.header }));
    expect(
      screen.queryByRole('columnheader', { name: new RegExp(hideable.header) }),
    ).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: /View options for sites/ }));
    await user.click(screen.getByRole('menuitemradio', { name: '25' }));
    expect(screen.getByText('Showing 1–23 of 23')).toBeInTheDocument();
  });

  it('starts with a column hidden when asked to', () => {
    const [first, second, ...rest] = columns;
    if (!first || !second) throw new Error('need two columns');
    renderTable({
      preferencesKey: 'sites',
      columns: [first, { ...second, defaultHidden: true }, ...rest],
    });
    expect(
      screen.queryByRole('columnheader', { name: new RegExp(second.header) }),
    ).not.toBeInTheDocument();
  });
});

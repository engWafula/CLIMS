import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';

import { envelope } from '@/test/fulfilmentFixtures';
import { testRouter } from '@/test/navigation';
import { renderApp } from '@/test/renderApp';

import { DistrictContextProvider, DistrictSelect, useDistrictContext } from './DistrictContext';

const DISTRICTS = [
  { id: 'd-wakiso', name: 'Wakiso' },
  { id: 'd-gulu', name: 'Gulu' },
  { id: 'd-kotido', name: 'Kotido' },
];

function SelectedDistrict() {
  const district = useDistrictContext();
  return <output>{district?.district ?? 'Unfiltered'}</output>;
}

function renderAt(route: string, { placesMenu = true } = {}) {
  return renderApp(
    <DistrictContextProvider>
      {/* The warehouse pages place the menu in their own toolbar row. */}
      {placesMenu ? <DistrictSelect /> : null}
      <SelectedDistrict />
    </DistrictContextProvider>,
    {
      signedIn: true,
      route,
      replies: [
        (request) => ({
          status: 200,
          body: envelope(request.url === '/locations/districts' ? DISTRICTS : []),
        }),
      ],
    },
  );
}

it('offers every district at a warehouse and keeps the choice across pages and stores', async () => {
  const user = userEvent.setup();
  const { requests } = renderAt('/warehouse?store=NMS');

  const selector = screen.getByRole('combobox', { name: 'District' });
  await waitFor(() => expect(selector).toBeEnabled());
  expect(selector).toHaveTextContent('All districts');
  await user.click(selector);
  // Kotido has sent nothing to either warehouse and is offered all the same.
  expect(await screen.findByRole('option', { name: 'Kotido' })).toBeInTheDocument();
  await user.click(screen.getByRole('option', { name: 'Wakiso' }));
  expect(screen.getByRole('status')).toHaveTextContent('Wakiso');

  act(() => {
    testRouter.push('/warehouse/requests?store=NMS');
  });
  expect(screen.getByRole('status')).toHaveTextContent('Wakiso');

  // An administrator or MOH switching store is still looking at Wakiso.
  act(() => {
    testRouter.push('/warehouse/requests?store=JMS');
  });
  expect(screen.getByRole('status')).toHaveTextContent('Wakiso');

  // The list comes from the locations lookup, not the warehouse's orders.
  expect(requests.some((request) => request.url.startsWith('/orders'))).toBe(false);
});

it('ignores a district in the address that is not in the list', async () => {
  renderAt('/warehouse/requests?store=NMS&district=Atlantis');

  const selector = screen.getByRole('combobox', { name: 'District' });
  await waitFor(() => expect(selector).toBeEnabled());
  expect(screen.getByRole('status')).toHaveTextContent('Unfiltered');
  expect(selector).toHaveTextContent('All districts');
});

it('leaves the menu to the warehouse page, which puts it beside the warehouse name', () => {
  renderAt('/warehouse?store=NMS', { placesMenu: false });

  expect(screen.queryByRole('combobox', { name: 'District' })).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Unfiltered');
});

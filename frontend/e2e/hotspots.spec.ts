import { expect, test } from '@playwright/test';

import { resetMock } from './support/mock';
import { expectToast, open } from './support/ui';

/*
 * Hotspot review (`dev/mock/hotspots.mts`, on the Go API's endpoints): a VHT submits a hotspot in
 * the mobile app, and the DCFP activates or rejects it, and can later deactivate it; every decision
 * needs a comment. The mock seeds Kajjansi Weekly Market and Bwebajja Nite Spot (submitted), Kasenyi
 * Landing Site and three more active hotspots, and Nansana Taxi Park (rejected), all in Wakiso.
 * The hotspots it generates for the map, in other districts, come after them in the list.
 */

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test('the DCFP activates a submitted hotspot with a comment, then deactivates it', async ({
  page,
}) => {
  await open(page, '/dcfp/hotspots', 'Hotspots');
  const row = page.getByRole('row', { name: /Kajjansi Weekly Market/ });
  const actions = page.getByRole('button', { name: 'Actions for Kajjansi Weekly Market' });

  await actions.click();
  await page.getByRole('menuitem', { name: 'Activate' }).click();
  const activate = page.getByRole('dialog', { name: 'Activate Kajjansi Weekly Market?' });
  await activate.getByLabel('Comment').fill('Visited on market day; stall owners agreed.');
  await activate.getByRole('button', { name: 'Activate hotspot' }).click();
  await expectToast(page, 'Hotspot activated');
  await expect(row).toContainText('active');

  await actions.click();
  await expect(page.getByRole('menuitem', { name: 'Reject' })).toBeHidden();
  await page.getByRole('menuitem', { name: 'Deactivate' }).click();
  const deactivate = page.getByRole('dialog', { name: 'Deactivate Kajjansi Weekly Market?' });
  await deactivate.getByLabel('Comment').fill('The market has moved.');
  await deactivate.getByRole('button', { name: 'Deactivate hotspot' }).click();
  await expectToast(page, 'Hotspot deactivated');
  await expect(row).toContainText('deactivated');
});

test('the DCFP rejects a hotspot only with a comment', async ({ page }) => {
  await open(page, '/dcfp/hotspots', 'Hotspots');
  await page.getByRole('button', { name: 'Actions for Bwebajja Nite Spot' }).click();
  await page.getByRole('menuitem', { name: 'Reject' }).click();

  const dialog = page.getByRole('dialog', { name: 'Reject Bwebajja Nite Spot?' });
  await dialog.getByRole('button', { name: 'Reject hotspot' }).click();
  await expect(dialog.getByText('Add a comment. It is kept with your decision.')).toBeVisible();

  await dialog.getByLabel('Comment').fill('No condoms are handed out here.');
  await dialog.getByRole('button', { name: 'Reject hotspot' }).click();

  await expectToast(page, 'Hotspot rejected');
  await expect(dialog).toBeHidden();
  const row = page.getByRole('row', { name: /Bwebajja Nite Spot/ });
  await expect(row).toContainText('rejected');
  // A rejected hotspot waits for the VHT to resubmit it: nothing is left for the DCFP.
  await expect(page.getByRole('button', { name: 'Actions for Bwebajja Nite Spot' })).toBeHidden();
});

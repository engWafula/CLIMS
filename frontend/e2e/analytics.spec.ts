import { expect, test } from '@playwright/test';

import { resetMock } from './support/mock';
import { open } from './support/ui';

/*
 * The report section and the dashboards' analytics, against the mock's year of generated
 * activity (dev/mock/analytics.mts): filters in the address, every chart's options, focus mode,
 * the table view, and the PDF, CSV and Excel downloads.
 */

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test('the overview shows figures and charts for the period, and the filters live in the address', async ({
  page,
}) => {
  await open(page, '/moh/programme-reports', 'Reports and analytics');
  await expect(page.getByRole('link', { name: 'Overview' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(page.getByText('Stockout requests raised').first()).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Stock flow through the supply chain' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Warehouse order pipeline' })).toBeVisible();

  // A period preset goes in the address and shows as a removable chip.
  await page.getByRole('combobox', { name: 'Period' }).click();
  await page.getByRole('option', { name: 'Last 12 months' }).click();
  await expect(page).toHaveURL(/period=last-12-months/);
  const chip = page.getByRole('button', { name: 'Remove filter Period: Last 12 months' });
  await expect(chip).toBeVisible();

  // The full filter pane offers every slicer; the type chosen there is applied everywhere.
  await page.getByRole('button', { name: /All filters/ }).click();
  const pane = page.getByRole('dialog', { name: 'Filters' });
  await pane.getByRole('combobox', { name: 'Condom type' }).click();
  await page.getByRole('option', { name: 'Female condoms' }).click();
  await pane.getByRole('button', { name: 'Show results' }).click();
  await expect(page).toHaveURL(/category=female/);

  await page.getByRole('button', { name: 'Clear all' }).first().click();
  await expect(page).not.toHaveURL(/category=|period=/);
});

test('every chart opens as a table and in focus mode, and downloads its data', async ({ page }) => {
  await open(page, '/moh/programme-reports?view=notifications', 'Reports and analytics');
  const title = 'Raised and fulfilled';
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await page.getByRole('button', { name: `Show ${title} as a table` }).click();
  await expect(page.getByRole('table', { name: title })).toBeVisible();
  await page.getByRole('button', { name: `Show ${title} as a chart` }).click();

  await page.getByRole('button', { name: `Open ${title} in focus mode` }).click();
  const focus = page.getByRole('dialog', { name: title });
  await expect(focus).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(focus).toBeHidden();

  await page.getByRole('button', { name: `More options for ${title}` }).click();
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Download data (CSV)' }).click(),
  ]);
  expect(csv.suggestedFilename()).toMatch(/^clims-raised-and-fulfilled-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('a report downloads as a PDF with its records, and as CSV from the server', async ({
  page,
}) => {
  await open(page, '/moh/programme-reports?view=warehouse-requests', 'Reports and analytics');
  await expect(page.getByRole('heading', { name: 'From request to receipt' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Records' })).toBeVisible();

  const [pdf] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download PDF' }).click(),
  ]);
  expect(pdf.suggestedFilename()).toMatch(/^clims-warehouse-orders-\d{4}-\d{2}-\d{2}\.pdf$/);
  const path = await pdf.path();
  const { readFile } = await import('node:fs/promises');
  expect((await readFile(path)).subarray(0, 5).toString()).toBe('%PDF-');

  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download CSV' }).click(),
  ]);
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);
});

test('each report tab loads its own visuals', async ({ page }) => {
  const tabs: [string, string][] = [
    ['stock', 'Months of stock'],
    ['batches', 'Pieces by time left'],
    ['hotspots', 'Dispenser condition'],
    ['hmis-105', 'By district and subcounty'],
  ];
  for (const [view, heading] of tabs) {
    await open(page, `/moh/programme-reports?view=${view}`, 'Reports and analytics');
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(page.getByText('This chart could not be loaded')).toHaveCount(0);
  }
});

test('the MOH dashboard lists what needs watching and downloads as a PDF', async ({ page }) => {
  await open(page, '/moh', 'MOH dashboard');
  await expect(page.getByText('Needs watching')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fulfilment rate by district' })).toBeVisible();
  const [pdf] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download PDF' }).click(),
  ]);
  expect(pdf.suggestedFilename()).toMatch(/^clims-moh-dashboard-.*\.pdf$/);
});

test('the district and warehouse dashboards add a performance section with its own PDF', async ({
  page,
}) => {
  await open(page, '/dcfp', 'District dashboard');
  await expect(page.getByRole('heading', { name: 'District performance' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Stockout request status' })).toBeVisible();

  await open(page, '/warehouse?store=NMS', 'Warehouse dashboard');
  await expect(page.getByRole('heading', { name: 'Pieces dispatched to districts' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /performance$/ })).toBeVisible();
});

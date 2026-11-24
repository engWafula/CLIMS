import { expect, test } from '@playwright/test';

import { ADMIN, AUTH_FILE } from './support/env';
import { resetMock } from './support/mock';
import { expectToast, open } from './support/ui';

// Signed out: these tests start from a browser with no session.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test('signs in and lands on the MOH dashboard', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();

  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/moh$/);
  await expect(page.getByRole('heading', { level: 1, name: 'MOH dashboard' })).toBeVisible();
});

test('a wrong password keeps the visitor on sign-in with the entries intact', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'Could not sign in' })).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByLabel('Email')).toHaveValue(ADMIN.email);
});

test('empty fields are flagged before anything is sent', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByText('Enter your email, username or phone number.')).toBeVisible();
  await expect(page.getByText('Enter your password.')).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
});

test.describe('signed in', () => {
  // Each test gets its own browser context from the saved state, so signing out here clears only
  // this context's session; the file, and every later test that starts from it, stay signed in.
  test.use({ storageState: AUTH_FILE });

  test('signs out from the account menu', async ({ page }) => {
    await open(page, '/moh', 'MOH dashboard');
    await page.getByRole('button', { name: /account menu/i }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    // The session is gone, not just hidden: opening a signed-in page goes back to sign-in.
    await page.goto('/moh');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('signs in as another role after an administrator signs out', async ({ page }) => {
    await open(page, '/moh/users', 'User management');
    const token = await page.evaluate(() => {
      const session = localStorage.getItem('clims.session');
      if (!session) throw new Error('Expected the administrator session');
      return (JSON.parse(session) as { token: string }).token;
    });
    await page.getByRole('button', { name: /account menu/i }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in$/);

    const district = {
      id: 'district-user',
      username: 'district',
      roles: [{ id: 'district-role', name: 'dfcp', permissions: ['orders:read'] }],
    };
    await page.route('**/api/v1/auth/login', (route) =>
      route.fulfill({
        json: { success: true, data: { token, user: district } },
      }),
    );
    await page.route('**/api/v1/auth/me', (route) =>
      route.fulfill({
        json: { success: true, data: district },
      }),
    );
    await page.getByLabel('Email').fill('district');
    await page.getByLabel('Password', { exact: true }).fill('password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dcfp$/);
    await expect(page.getByRole('heading', { level: 1, name: 'District dashboard' })).toBeVisible();
  });

  test('signs another device out from the account menu', async ({ page }) => {
    await open(page, '/moh', 'MOH dashboard');
    await page.getByRole('button', { name: /account menu/i }).click();
    await page.getByRole('menuitem', { name: 'Signed-in devices' }).click();

    const dialog = page.getByRole('dialog', { name: 'Signed-in devices' });
    const devices = dialog.getByRole('list', { name: 'Your signed-in devices' });
    // The mock's third session was signed out already, so it is not listed.
    await expect(devices.getByRole('listitem')).toHaveCount(2);
    await expect(devices.getByRole('listitem').first()).toContainText('This device');
    // Chromium spaces the hidden ", Android app" off as its own box: "Sign out , Android app".
    await dialog.getByRole('button', { name: /^Sign out\s*, Android app$/ }).click();

    await expectToast(page, 'Signed out of Android app');
    await expect(devices.getByRole('listitem')).toHaveCount(1);
    await expect(
      dialog.getByText('This is the only device signed in to your account.'),
    ).toBeVisible();
  });
});

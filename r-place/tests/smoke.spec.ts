import { test, expect, Page } from '@playwright/test';

/**
 * Login helper function
 */
async function login(page: Page) {
  await page.goto('/');
  await page.locator("input[type='text']").first().fill('alice');
  await page.locator("input[type='password']").first().fill('password123');
  await page.locator("button[type='submit']").first().click();
  // Wait for navigation after login
  await page.waitForURL(/(?!.*login).*/);
}

test.describe('r-place Smoke Tests', () => {

  test('01 canvas unauthenticated loads correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);

    // Verify page content loads
    await expect(page.locator('canvas')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

  test('02 canvas authenticated loads correctly', async ({ page }) => {
    await login(page);
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Verify page content loads
    await expect(page.locator('canvas')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

});

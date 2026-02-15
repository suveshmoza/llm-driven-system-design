import { test, expect, Page } from '@playwright/test';

test.describe('rate-limiter Smoke Tests', () => {

  test('01 dashboard loads correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);

    // Verify page content loads
    await expect(page.locator('header')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

});

import { test, expect, Page } from '@playwright/test';

test.describe('apple-maps Smoke Tests', () => {

  test('01 map view loads correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Verify page content loads
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

});

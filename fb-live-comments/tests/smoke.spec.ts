import { test, expect, Page } from '@playwright/test';

test.describe('fb-live-comments Smoke Tests', () => {

  test('01 live stream loads correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Verify page content loads
    await expect(page.locator('.flex')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

});

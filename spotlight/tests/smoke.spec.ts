import { test, expect, Page } from '@playwright/test';

test.describe('spotlight Smoke Tests', () => {

  test('01 landing loads correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    // Verify page content loads
    await expect(page.locator('h1')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

});

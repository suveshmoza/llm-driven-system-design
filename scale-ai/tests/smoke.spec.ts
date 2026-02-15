import { test, expect, Page } from '@playwright/test';

test.describe('scale-ai Smoke Tests', () => {

  test('01 drawing game loads correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    // Verify page content loads
    await expect(page.locator('canvas')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

  test('02 admin loads correctly', async ({ page }) => {
    await page.goto('/#admin');
    await page.waitForTimeout(500);

    // Verify page content loads
    await expect(page.locator('main')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

  test('03 implement loads correctly', async ({ page }) => {
    await page.goto('/#implement');
    await page.waitForTimeout(500);

    // Verify page content loads
    await expect(page.locator('main')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

});

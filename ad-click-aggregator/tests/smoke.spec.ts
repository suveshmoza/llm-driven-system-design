import { test, expect, Page } from '@playwright/test';

test.describe('ad-click-aggregator Smoke Tests', () => {

  test('01 dashboard loads correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    // Verify page content loads
    await expect(page.locator('main')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

  test('02 campaigns loads correctly', async ({ page }) => {
    await page.goto('/campaigns');
    await page.waitForTimeout(500);

    // Verify page content loads
    await expect(page.locator('main')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

  test('03 analytics loads correctly', async ({ page }) => {
    await page.goto('/analytics');
    await page.waitForTimeout(500);

    // Verify page content loads
    await expect(page.locator('main')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

  test('04 clicks loads correctly', async ({ page }) => {
    await page.goto('/clicks');
    await page.waitForTimeout(500);

    // Verify page content loads
    await expect(page.locator('main')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

});

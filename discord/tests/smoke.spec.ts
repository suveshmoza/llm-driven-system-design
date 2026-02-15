import { test, expect, Page } from '@playwright/test';

/**
 * Login helper function
 */
async function login(page: Page) {
  await page.goto('/login');
  await page.locator("input#nickname, input[name='nickname'], input[type='text']").first().fill('alice');
  await page.locator("input[name='password'], input[type='password']").first().fill('password123');
  await page.locator("button[type='submit']").first().click();
  // Wait for navigation after login
  await page.waitForURL(/(?!.*login).*/);
}

test.describe('discord Smoke Tests', () => {

  test('01 login loads correctly', async ({ page }) => {
    await page.goto('/login');
    await page.waitForTimeout(500);

    // Verify page content loads
    await expect(page.locator('form')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

  test('02 home loads correctly', async ({ page }) => {
    await login(page);
    await page.goto('/channels/@me');
    await page.waitForTimeout(1500);

    // Verify page content loads
    await expect(page.locator('main')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

  test('03 general channel loads correctly', async ({ page }) => {
    await login(page);
    await page.goto('/channels/general');
    await page.waitForTimeout(2000);

    // Verify page content loads
    await expect(page.locator('.font-semibold')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

  test('04 tech talk channel loads correctly', async ({ page }) => {
    await login(page);
    await page.goto('/channels/tech-talk');
    await page.waitForTimeout(1500);

    // Verify page content loads
    await expect(page.locator('.font-semibold')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

  test('05 gaming channel loads correctly', async ({ page }) => {
    await login(page);
    await page.goto('/channels/gaming');
    await page.waitForTimeout(1500);

    // Verify page content loads
    await expect(page.locator('.font-semibold')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

  test('06 random channel loads correctly', async ({ page }) => {
    await login(page);
    await page.goto('/channels/random');
    await page.waitForTimeout(1500);

    // Verify page content loads
    await expect(page.locator('.font-semibold')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

});

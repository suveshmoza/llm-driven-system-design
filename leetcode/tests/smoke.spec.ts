import { test, expect, Page } from '@playwright/test';

/**
 * Login helper function
 */
async function login(page: Page) {
  await page.goto('/login');
  await page.locator("input#username, input[type='text']").first().fill('demo');
  await page.locator("input#password, input[type='password']").first().fill('user123');
  await page.locator("button[type='submit']").first().click();
  // Wait for navigation after login
  await page.waitForURL(/(?!.*login).*/);
}

test.describe('leetcode Smoke Tests', () => {

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
    await page.goto('/');
    await page.waitForTimeout(1000);

    // Verify page content loads
    await expect(page.locator('.min-h-screen')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

  test('03 problems list loads correctly', async ({ page }) => {
    await login(page);
    await page.goto('/problems');
    await page.waitForTimeout(1500);

    // Verify page content loads
    await expect(page.locator('table')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

  test('04 problem detail loads correctly', async ({ page }) => {
    await login(page);
    await page.goto('/problems/two-sum');
    await page.waitForTimeout(2000);

    // Verify page content loads
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

  test('05 progress loads correctly', async ({ page }) => {
    await login(page);
    await page.goto('/progress');
    await page.waitForTimeout(1000);

    // Verify page content loads
    await expect(page.locator('.min-h-screen')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

  test('06 register loads correctly', async ({ page }) => {
    await page.goto('/register');
    await page.waitForTimeout(500);

    // Verify page content loads
    await expect(page.locator('form')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

});

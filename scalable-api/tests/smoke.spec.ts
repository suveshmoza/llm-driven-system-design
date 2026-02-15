import { test, expect, Page } from '@playwright/test';

/**
 * Login helper function
 */
async function login(page: Page) {
  await page.goto('/');
  await page.locator("input[name='email'], input#email").first().fill('admin@example.com');
  await page.locator("input[name='password'], input#password").first().fill('admin123');
  await page.locator("button[type='submit']").first().click();
  // Wait for navigation after login
  await page.waitForURL(/(?!.*login).*/);
}

test.describe('scalable-api Smoke Tests', () => {

  test('01 login page loads correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    // Verify page content loads
    await expect(page.locator('form')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

  test('02 dashboard loads correctly', async ({ page }) => {
    await login(page);
    await page.goto('/');
    await page.waitForTimeout(1500);

    // Verify page content loads
    await expect(page.locator('header')).toBeVisible({ timeout: 10000 });

    // Verify no React error boundary
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    await expect(page.locator('text=Error boundary')).not.toBeVisible();
  });

});

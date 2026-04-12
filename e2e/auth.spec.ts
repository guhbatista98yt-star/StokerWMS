import { test, expect } from '@playwright/test';

test.describe('Authentication & Basic Navigation', () => {
    test('should login as admin and navigate to dashboard', async ({ page }) => {
        await page.goto('/');

        // Verify we are redirected to login
        await expect(page).toHaveURL(/.*\/login/);

        // Fill the login form
        await page.fill('input[name="username"]', 'test_admin');
        await page.fill('input[name="password"]', 'admin123');
        await page.click('button[type="submit"]');

        // Wait for the navigation to dashboard or pick the layout
        await expect(page).not.toHaveURL(/.*\/login/);

        // We should see the logo or admin name
        await expect(page.locator('text=Admin Test')).toBeVisible();
    });
});

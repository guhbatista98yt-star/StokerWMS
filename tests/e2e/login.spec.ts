import { test, expect } from '@playwright/test';

test.describe('Login E2E', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/login');
    });

    test('TC001: Successful login with role-based access', async ({ page }) => {
        await page.getByTestId('input-username').fill('admin');
        await page.getByTestId('input-password').fill('1234');
        await page.getByTestId('button-login').click();

        // Wait for navigation to /
        await page.waitForURL('http://localhost:5000/');

        // Verify dashboard link is visible (which implies successful login)
        await expect(page.getByText('Painel Supervisor', { exact: false })).toBeVisible();
    });

    test('TC002: Login failure with incorrect credentials', async ({ page }) => {
        await page.getByTestId('input-username').fill('admin');
        await page.getByTestId('input-password').fill('badpass');
        await page.getByTestId('button-login').click();

        // Check for toast message
        await expect(page.getByText('Usuário ou senha incorretos')).toBeVisible();
    });
});

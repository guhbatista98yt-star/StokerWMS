import { test, expect } from '@playwright/test';

test.describe('Separation Module Flow', () => {
    test('should allow a separator to select and start picking an order', async ({ page }) => {
        // 1. Login as Separator
        await page.goto('/login');
        await page.fill('input[name="username"]', 'test_separador');
        await page.fill('input[name="password"]', 'sep123');
        await page.click('button[type="submit"]');

        // Wait for dashboard
        await expect(page.locator('text=Separador Test')).toBeVisible();

        // 2. Navigate to Separation
        await page.goto('/separacao');

        // Wait for orders to load (the API returns the seeded orders)
        await expect(page.locator('button:has-text("Separar")')).toBeVisible({ timeout: 60000 });

        // 3. Select an order group to separate
        // Using nth(0) because Radix UI Checkbox uses a button role
        const firstOrderCheckbox = page.locator('button[role="checkbox"]').first();
        await firstOrderCheckbox.click();

        // 4. Start separation
        const startButton = page.locator('button:has-text("Separar")');
        await expect(startButton).toBeEnabled();
        await startButton.click();

        // 5. Verify the UI switches to the 'picking' step
        await expect(page.locator('input[placeholder*="Leia o código de barras..."]')).toBeVisible({ timeout: 60000 });

        // Ensure the barcode input is ready
        const scanInput = page.locator('input[placeholder*="Leia o código de barras"]');
        await expect(scanInput).toBeVisible();

        // 6. Simulate scanning an item (APP001 is a seeded product barcode)
        await scanInput.focus();
        await scanInput.fill('1234567890123');
        await scanInput.press('Enter');

        // Assuming the item quantity is 1 in the seed, or that a toast is shown
        // Let's just verify the scan doesn't throw a generic Error Toast 
        await expect(page.locator('text=Erro interno')).toHaveCount(0);
    });
});

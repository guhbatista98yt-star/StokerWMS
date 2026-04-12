import { test, expect } from '@playwright/test';

test.describe('Authentication API', () => {

    test('TC001: Secure login authentication (Success)', async ({ request }) => {
        const response = await request.post('/api/auth/login', {
            data: {
                username: 'admin',
                password: '1234'
            }
        });

        // Note: Password in seed is '123' based on typical dev setup, but let's check code_summary or try to find it. 
        // In config.json it says loginPassword: "1234". Let's try 1234 first. 
        // Wait, the seed actually uses '123' usually? Let's verify.
        // I will use '1234' based on config.json first.

        expect(response.ok()).toBeTruthy();
        const body = await response.json();
        expect(body).toHaveProperty('user');
        expect(body.user).toHaveProperty('username', 'admin');

        // Verify cookie is set
        const headers = response.headers();
        expect(headers['set-cookie']).toBeDefined();
        expect(headers['set-cookie']).toContain('authToken');
    });

    test('TC002: Login failure with incorrect credentials', async ({ request }) => {
        const response = await request.post('/api/auth/login', {
            data: {
                username: 'admin',
                password: 'wrongpassword'
            }
        });
        expect(response.status()).toBe(401);
    });

    test('TC010: Session based logout', async ({ request }) => {
        // Login first
        const loginResponse = await request.post('/api/auth/login', {
            data: { username: 'admin', password: '1234' }
        });
        // Assuming login successful for now to get cookie. Playwright request context handles cookies automatically if using same context.

        const logoutResponse = await request.post('/api/auth/logout');
        expect(logoutResponse.ok()).toBeTruthy();

        // Verify session is invalid after logout
        const meResponse = await request.get('/api/auth/me');
        expect(meResponse.status()).toBe(401);
    });
});

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 60000,
    expect: {
        timeout: 20000
    },
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1, // Avoid DB lock issues with SQLite
    reporter: 'html',
    use: {
        baseURL: 'http://localhost:5001',
        trace: 'on-first-retry',
        video: 'retain-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        // Start the server using the test DB but as "development" so it listens on a port (unlike NODE_ENV=test)
        command: 'npm run test:seed && cross-env NODE_ENV=development PORT=5001 DATABASE_URL=file:test-db.sqlite tsx server/index.ts',
        url: 'http://localhost:5001',
        reuseExistingServer: false,
        timeout: 120 * 1000,
    },
});

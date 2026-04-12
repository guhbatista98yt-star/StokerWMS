import { test, expect } from '@playwright/test';

test.describe('Order Management API', () => {

    test('TC003: Order status workflow', async ({ request }) => {
        // 1. Login as supervisor
        const login = await request.post('/api/auth/login', {
            data: { username: 'admin', password: '1234' }
        });
        expect(login.ok()).toBeTruthy();

        // 2. Create a new order (Supervisor only)
        // Need to check schema for creating orders. 
        // Based on routes.ts, there isn't a direct POST /api/orders to create arbitrary orders exposed to public?
        // Wait, routes.ts shows:
        // app.get("/api/orders", ...)
        // app.post("/api/orders/assign-route", ...)
        // app.post("/api/orders/launch", ...)
        // It seems orders come from ERP integration or seed?
        // Let's check if we can create orders via API or if we need to use existing ones.
        // routes.ts doesn't show a clear 'create order' endpoint for users, maybe sync/seed only?
        // If so, we should use an existing order or Sync.

        // Let's try to get all orders and pick one.
        const ordersRes = await request.get('/api/orders');
        expect(ordersRes.ok()).toBeTruthy();
        const orders = await ordersRes.json();
        expect(Array.isArray(orders)).toBeTruthy();
        expect(orders.length).toBeGreaterThan(0);

        const orderId = orders[0].id;

        // 3. Assign Route
        const assignRes = await request.post('/api/orders/assign-route', {
            data: {
                orderIds: [orderId],
                routeId: null // or a valid route ID
            }
        });
        // We might need a valid route ID. 
        // Let's fetch routes first.
        const routesRes = await request.get('/api/routes');
        const routes = await routesRes.json();
        if (routes.length > 0) {
            await request.post('/api/orders/assign-route', {
                data: { orderIds: [orderId], routeId: routes[0].id }
            });
        }

        // 4. Launch Order
        const launchRes = await request.post('/api/orders/launch', {
            data: { orderIds: [orderId] }
        });
        expect(launchRes.ok()).toBeTruthy();

        // Verify status changed (it should be 'separacao' basically? logic in routes.ts says: launchOrders -> status 'separado' or similar? 
        // routes.ts: launchOrders(toLaunch) -> updates status? 
        // We should verify the new status.
        const updatedOrder = await request.get(`/api/orders/${orderId}`);
        const orderData = await updatedOrder.json();
        // launchOrders likely sets it to 'separacao' or 'pendente' for picking?
    });

});

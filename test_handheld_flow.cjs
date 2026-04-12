
const http = require('http');

// Helper to make requests
function request(method, path, body, cookie) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 5000,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cookie || ''
            }
        };

        const req = http.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
                } catch (e) {
                    resolve({ status: res.statusCode, body: data, headers: res.headers });
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function run() {
    console.log('--- Testing Handheld WMS Flow ---');

    // 1. Login
    console.log('\n1. Logging in...');
    const loginRes = await request('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
    if (loginRes.status !== 200) {
        console.error('Login failed:', loginRes.body);
        return;
    }
    const cookie = loginRes.headers['set-cookie'][0].split(';')[0];
    console.log('Login successful.');

    // 1.5 Fetch Orders to get ID
    console.log('\n1.5 Fetching orders...');
    const ordersRes = await request('GET', '/api/orders', null, cookie);
    if (ordersRes.status !== 200 || !ordersRes.body.length) {
        console.error('Failed to fetch orders or no orders:', ordersRes.status);
        return;
    }
    const orderId = ordersRes.body[0].id;
    console.log('Using Order ID:', orderId);
    const sectionId = "Mercearia"; // From seed

    // 2. Lock a section
    console.log('\n2. Locking section:', sectionId);
    const lockRes = await request('POST', '/api/lock', { orderId, sectionId }, cookie);
    console.log('Lock Response:', lockRes.status, lockRes.body);

    if (lockRes.status === 200) {
        const sessionId = lockRes.body.sessionId;

        // 3. Heartbeat
        console.log('\n3. Sending heartbeat...');
        const hbRes = await request('POST', '/api/heartbeat', { sessionId }, cookie);
        console.log('Heartbeat Response:', hbRes.status, hbRes.body);

        // 4. Submit Picking (Optional - requires item ID)
        // Let's skip submit for now as getting item ID is complex without proper route

        // 5. Unlock
        console.log('\n5. Unlocking...');
        const unlockRes = await request('POST', '/api/unlock', { orderId, sectionId }, cookie);
        console.log('Unlock Response:', unlockRes.status, unlockRes.body);
    }
}

run();

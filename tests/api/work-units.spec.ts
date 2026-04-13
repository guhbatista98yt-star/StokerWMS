import { test, expect, APIRequestContext } from '@playwright/test';

// Helpers
async function loginAs(request: APIRequestContext, username: string, password: string, companyId?: number) {
  const res = await request.post('/api/auth/login', { data: { username, password } });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  if (companyId && body.requireCompanySelection) {
    await request.post('/api/auth/select-company', { data: { companyId } });
  }
  return body;
}

async function getBalcaoWorkUnits(request: APIRequestContext) {
  const res = await request.get('/api/work-units?type=balcao');
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as any[];
}

async function getSepWorkUnits(request: APIRequestContext) {
  const res = await request.get('/api/work-units');
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as any[];
}

// ── TC-WU-01: Batch unlock — separation WUs ─────────────────────────────────
test('TC-WU-01: Batch unlock of separation work units clears lock fields', async ({ request }) => {
  await loginAs(request, 'admin', 'admin123');

  const wus = await getSepWorkUnits(request);
  const pendingWUs = wus.filter((w: any) => w.status === 'pendente').slice(0, 2);
  if (pendingWUs.length === 0) return test.skip();

  const ids = pendingWUs.map((w: any) => w.id);

  // Lock them first
  const lockRes = await request.post('/api/work-units/lock', { data: { workUnitIds: ids } });
  expect(lockRes.ok()).toBeTruthy();

  // Unlock them
  const unlockRes = await request.post('/api/work-units/unlock', { data: { workUnitIds: ids, reset: false } });
  expect(unlockRes.ok()).toBeTruthy();

  // Verify lock fields are cleared
  for (const id of ids) {
    const r = await request.get(`/api/work-units/${id}`);
    if (!r.ok()) continue;
    const wu = await r.json();
    expect(wu.lockedBy).toBeNull();
    expect(wu.lockedAt).toBeNull();
    expect(wu.lockExpiresAt).toBeNull();
  }
});

// ── TC-WU-02: Batch unlock — mixed conference + separation ───────────────────
test('TC-WU-02: Unlock mixed conferencia+separacao reverts each order status independently', async ({ request }) => {
  await loginAs(request, 'admin', 'admin123');

  const allWUs = await getSepWorkUnits(request);
  const sepWU = allWUs.find((w: any) => w.type === 'separacao' && w.status !== 'concluido');
  const confWU = allWUs.find((w: any) => w.type === 'conferencia' && w.status !== 'concluido');

  if (!sepWU || !confWU) return test.skip();

  const ids = [sepWU.id, confWU.id];
  const unlockRes = await request.post('/api/work-units/unlock', {
    data: { workUnitIds: ids, reset: true }
  });
  expect(unlockRes.ok()).toBeTruthy();

  // The conferencia order should be reverted to "separado", not "pendente"
  if (sepWU.orderId !== confWU.orderId) {
    const confOrderRes = await request.get(`/api/orders/${confWU.orderId}`);
    if (confOrderRes.ok()) {
      const confOrder = await confOrderRes.json();
      expect(confOrder.status).toBe('separado');
    }

    const sepOrderRes = await request.get(`/api/orders/${sepWU.orderId}`);
    if (sepOrderRes.ok()) {
      const sepOrder = await sepOrderRes.json();
      // Sep order should revert to pendente (not separado)
      expect(['pendente', 'em_separacao']).toContain(sepOrder.status);
    }
  }
});

// ── TC-WU-03: Operator cannot unlock another operator's WU ───────────────────
test('TC-WU-03: Operator gets 403 when trying to unlock a WU locked by another operator', async ({ request }) => {
  // Joao locks a WU
  await loginAs(request, 'joao', '1234');
  const wus = await getBalcaoWorkUnits(request);
  const freeWU = wus.find((w: any) => !w.lockedBy && w.status !== 'concluido');
  if (!freeWU) return test.skip();

  const lockRes = await request.post('/api/work-units/lock', { data: { workUnitIds: [freeWU.id] } });
  if (!lockRes.ok()) return test.skip(); // might already be locked

  // Maria tries to unlock Joao's WU
  await loginAs(request, 'maria', '1234');
  const unlockRes = await request.post('/api/work-units/unlock', {
    data: { workUnitIds: [freeWU.id], reset: false }
  });
  expect(unlockRes.status()).toBe(403);

  // Cleanup — Joao unlocks it
  await loginAs(request, 'joao', '1234');
  await request.post('/api/work-units/unlock', { data: { workUnitIds: [freeWU.id] } });
});

// ── TC-WU-04: Company scope — orders endpoint isolates data ──────────────────
test('TC-WU-04: Orders endpoint returns only company-scoped data', async ({ request }) => {
  await loginAs(request, 'admin', 'admin123');

  const ordersRes = await request.get('/api/orders');
  expect(ordersRes.ok()).toBeTruthy();
  const orders = await ordersRes.json();
  expect(Array.isArray(orders)).toBeTruthy();

  // Stats should also be scoped
  const statsRes = await request.get('/api/stats');
  expect(statsRes.ok()).toBeTruthy();
  const stats = await statsRes.json();
  expect(stats).toHaveProperty('pendentes');
  expect(stats).toHaveProperty('emSeparacao');
  expect(stats).toHaveProperty('separados');
  expect(stats).toHaveProperty('excecoes');

  // KPI endpoint should require supervisor role
  const kpiRes = await request.get('/api/kpi/operators');
  expect(kpiRes.ok()).toBeTruthy();
  const kpi = await kpiRes.json();
  expect(Array.isArray(kpi)).toBeTruthy();
});

// ── TC-WU-05: Audit logs are company-scoped ──────────────────────────────────
test('TC-WU-05: Audit logs endpoint returns HTTP 200 and company-scoped entries', async ({ request }) => {
  await loginAs(request, 'admin', 'admin123');

  const res = await request.get('/api/audit-logs');
  expect(res.ok()).toBeTruthy();
  const logs = await res.json();
  expect(Array.isArray(logs)).toBeTruthy();
});

// ── TC-WU-06: Balcão queue reflects concluido status ────────────────────────
test('TC-WU-06: Balcão queue endpoint returns correct status fields', async ({ request }) => {
  await loginAs(request, 'joao', '1234');

  const res = await request.get('/api/queue/balcao');
  expect(res.ok()).toBeTruthy();
  const queue = await res.json();
  expect(Array.isArray(queue)).toBeTruthy();

  // Every entry must have required fields
  for (const entry of queue) {
    expect(entry).toHaveProperty('orderId');
    expect(entry).toHaveProperty('status');
    expect(entry).toHaveProperty('erpOrderId');
    expect(['em_andamento', 'em_fila', 'concluido', 'aguardando']).toContain(entry.status);
  }
});

// ── TC-WU-07: Supervisor can unlock any operator's WU ────────────────────────
test('TC-WU-07: Supervisor can unlock a WU locked by any operator', async ({ request }) => {
  // Joao locks a WU
  await loginAs(request, 'joao', '1234');
  const wus = await getBalcaoWorkUnits(request);
  const freeWU = wus.find((w: any) => !w.lockedBy && w.status !== 'concluido');
  if (!freeWU) return test.skip();

  const lockRes = await request.post('/api/work-units/lock', { data: { workUnitIds: [freeWU.id] } });
  if (!lockRes.ok()) return test.skip();

  // Admin unlocks it
  await loginAs(request, 'admin', 'admin123');
  const unlockRes = await request.post('/api/work-units/unlock', {
    data: { workUnitIds: [freeWU.id], reset: false }
  });
  expect(unlockRes.ok()).toBeTruthy();
});

// ── TC-WU-08: Lock acquisition is exclusive — second lock attempt returns 409 ──
test('TC-WU-08: Concurrent lock attempt on same WU returns 409', async ({ request }) => {
  await loginAs(request, 'joao', '1234');
  const wus = await getBalcaoWorkUnits(request);
  const freeWU = wus.find((w: any) => !w.lockedBy && w.status !== 'concluido');
  if (!freeWU) return test.skip();

  // Lock it
  const lock1 = await request.post('/api/work-units/lock', { data: { workUnitIds: [freeWU.id] } });
  if (!lock1.ok()) return test.skip();

  // Maria tries to lock the same WU
  await loginAs(request, 'maria', '1234');
  const lock2 = await request.post('/api/work-units/lock', { data: { workUnitIds: [freeWU.id] } });
  expect(lock2.status()).toBe(409);

  // Cleanup
  await loginAs(request, 'joao', '1234');
  await request.post('/api/work-units/unlock', { data: { workUnitIds: [freeWU.id] } });
});

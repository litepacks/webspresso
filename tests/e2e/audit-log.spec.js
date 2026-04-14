/**
 * Audit log plugin E2E — API + optional UI smoke
 */

const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:3001';

const TEST_ADMIN = {
  name: 'Test Admin',
  email: 'admin@test.com',
  password: 'password123',
};

async function ensureLoggedIn(page) {
  await page.goto(`${BASE_URL}/_admin`);
  await page.waitForLoadState('networkidle');

  await page.waitForSelector('h1', { timeout: 10000 });
  const heading = await page.locator('h1').textContent();

  if (heading.includes('Setup Admin Account')) {
    await page.fill('input[name="name"]', TEST_ADMIN.name);
    await page.fill('input[name="email"]', TEST_ADMIN.email);
    await page.fill('input[name="password"]', TEST_ADMIN.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(_admin)?(\/)?$/, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
  } else if (heading.includes('Admin Login')) {
    await page.fill('input[name="email"]', TEST_ADMIN.email);
    await page.fill('input[name="password"]', TEST_ADMIN.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(_admin)?(\/)?$/, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
  }

  await page.waitForSelector('text=Admin Panel', { timeout: 10000 });
}

test.describe('Audit log API', () => {
  test('returns 401 without session', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/_admin/api/audit-logs`);
    expect(res.status()).toBe(401);
  });

  test('records create, update, and delete on model CRUD', async ({ page }) => {
    await ensureLoggedIn(page);

    const uniqueTitle = `Audit E2E ${Date.now()}`;

    const createRes = await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
      data: {
        title: uniqueTitle,
        content: 'Content for audit e2e at least ten chars',
        published: false,
        status: 'draft',
      },
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    const id = String(created.data.id);

    const listAfterCreate = await page.request.get(
      `${BASE_URL}/_admin/api/audit-logs?perPage=50&action=create&model=TestPost`
    );
    expect(listAfterCreate.status()).toBe(200);
    const bodyCreate = await listAfterCreate.json();
    const createRow = (bodyCreate.data || []).find(
      (r) => r.resource_id === id && r.action === 'create' && r.resource_model === 'TestPost'
    );
    expect(createRow).toBeTruthy();
    expect(createRow.actor_email).toBe(TEST_ADMIN.email);

    const updateRes = await page.request.put(`${BASE_URL}/_admin/api/models/TestPost/records/${id}`, {
      data: { title: `${uniqueTitle} updated`, published: true },
    });
    expect(updateRes.status()).toBe(200);

    const listAfterUpdate = await page.request.get(
      `${BASE_URL}/_admin/api/audit-logs?perPage=50&action=update&model=TestPost`
    );
    expect(listAfterUpdate.status()).toBe(200);
    const bodyUpdate = await listAfterUpdate.json();
    const updateRow = (bodyUpdate.data || []).find(
      (r) => r.resource_id === id && r.action === 'update'
    );
    expect(updateRow).toBeTruthy();
    if (updateRow.metadata) {
      const meta = typeof updateRow.metadata === 'string' ? JSON.parse(updateRow.metadata) : updateRow.metadata;
      expect(meta.changedFields).toContain('title');
    }

    const deleteRes = await page.request.delete(`${BASE_URL}/_admin/api/models/TestPost/records/${id}`);
    expect(deleteRes.status()).toBe(200);

    const listAfterDelete = await page.request.get(
      `${BASE_URL}/_admin/api/audit-logs?perPage=50&action=delete&model=TestPost`
    );
    expect(listAfterDelete.status()).toBe(200);
    const bodyDelete = await listAfterDelete.json();
    const deleteRow = (bodyDelete.data || []).find(
      (r) => r.resource_id === id && r.action === 'delete'
    );
    expect(deleteRow).toBeTruthy();
  });

  test('supports pagination meta', async ({ page }) => {
    await ensureLoggedIn(page);
    const res = await page.request.get(`${BASE_URL}/_admin/api/audit-logs?page=1&perPage=5`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('data');
    expect(json).toHaveProperty('meta');
    expect(json.meta).toHaveProperty('page', 1);
    expect(json.meta).toHaveProperty('perPage', 5);
    expect(typeof json.meta.total).toBe('number');
  });
});

test.describe('Audit log UI', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('loads audit log page from menu', async ({ page }) => {
    await page.goto(`${BASE_URL}/_admin`);
    await page.waitForLoadState('networkidle');

    const link = page.locator('aside a[href*="/audit-log"], nav a[href*="/audit-log"]').first();
    await expect(link).toBeVisible({ timeout: 10000 });
    await link.click();

    await page.waitForURL(/\/_admin\/audit-log/, { timeout: 15000 });
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Loading').or(page.locator('text=Total:'))).toBeVisible({
      timeout: 15000,
    });
  });
});

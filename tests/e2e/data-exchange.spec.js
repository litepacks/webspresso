/**
 * Data exchange (CSV/XLSX import, Excel export) E2E — authenticated HTTP API against the real E2E server.
 * (Admin UI relies on external CDN scripts; browser smoke for buttons is covered in Vitest integration tests.)
 */

const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://127.0.0.1:3001';

const TEST_ADMIN = {
  name: 'Test Admin',
  email: 'admin@test.com',
  password: 'password123',
};

/** APIRequestContext retains cookies across calls within the same test. */
async function adminApiRequest(request) {
  const setup = await request.post(`${BASE_URL}/_admin/api/auth/setup`, {
    data: {
      name: TEST_ADMIN.name,
      email: TEST_ADMIN.email,
      password: TEST_ADMIN.password,
    },
  });
  if (!setup.ok() && setup.status() !== 400) {
    expect(setup.ok(), `setup failed: ${setup.status()}`).toBeTruthy();
  }
  const login = await request.post(`${BASE_URL}/_admin/api/auth/login`, {
    data: { email: TEST_ADMIN.email, password: TEST_ADMIN.password },
  });
  expect(login.ok()).toBeTruthy();
}

test.describe('Data exchange plugin', () => {
  test('authenticated API: export TestPost as xlsx', async ({ request }) => {
    await adminApiRequest(request);

    const response = await request.post(`${BASE_URL}/_admin/api/data-exchange/export/TestPost`, {
      data: { selectAll: true, filters: {} },
    });

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type'] || '').toMatch(/spreadsheet/);
    const buf = await response.body();
    expect(buf.length).toBeGreaterThan(100);
    expect(buf.subarray(0, 2).toString()).toBe('PK');
  });

  test('authenticated API: import CSV into TestPost', async ({ request }) => {
    await adminApiRequest(request);

    const csv =
      'title,content,status,published\n' +
      'E2E Import Row,0123456789 extra,draft,0\n';

    const response = await request.post(
      `${BASE_URL}/_admin/api/data-exchange/import/TestPost?mode=insert`,
      {
        multipart: {
          file: {
            name: 'import.csv',
            mimeType: 'text/csv',
            buffer: Buffer.from(csv, 'utf8'),
          },
        },
      }
    );

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.created).toBeGreaterThanOrEqual(1);
    expect(body.failed).toBe(0);
  });

});

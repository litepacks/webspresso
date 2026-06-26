/**
 * Content plugin E2E — API, admin UI, public page, inline edit + step screenshots.
 */

const { test, expect } = require('@playwright/test');
const { captureStepScreenshot } = require('./helpers/screenshot');

const BASE_URL = 'http://127.0.0.1:3001';

const TEST_ADMIN = {
  name: 'Test Admin',
  email: 'admin@test.com',
  password: 'password123',
};

async function ensureLoggedIn(page) {
  await page.goto(`${BASE_URL}/_admin`, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForSelector('h1', { timeout: 45_000 });
  const heading = await page.locator('h1').textContent();

  if (heading.includes('Setup Admin Account')) {
    await page.fill('input[name="name"]', TEST_ADMIN.name);
    await page.fill('input[name="email"]', TEST_ADMIN.email);
    await page.fill('input[name="password"]', TEST_ADMIN.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(_admin)?(\/)?$/, { timeout: 15_000 });
    await page.waitForLoadState('load');
  } else if (heading.includes('Admin Login')) {
    await page.fill('input[name="email"]', TEST_ADMIN.email);
    await page.fill('input[name="password"]', TEST_ADMIN.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(_admin)?(\/)?$/, { timeout: 15_000 });
    await page.waitForLoadState('load');
  }

  await page.waitForSelector('text=Admin Panel', { timeout: 15_000 });
}

test.describe('Content plugin API', () => {
  test('returns 401 without session', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/_admin/api/content/types`);
    expect(res.status()).toBe(401);
  });

  test('public API returns seeded hero entry', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/content/hero/home`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.type).toBe('hero');
    expect(json.slug).toBe('home');
    expect(json.data.headline).toBe('E2E Hero Headline');
    expect(json.meta.status).toBe('published');
  });

  test('admin can create and delete a content type', async ({ page }) => {
    await ensureLoggedIn(page);

    const slug = `e2e-type-${Date.now()}`;
    const createRes = await page.request.post(`${BASE_URL}/_admin/api/content/types`, {
      data: {
        slug,
        name: 'E2E Type',
        schema: { fields: [{ name: 'title', type: 'text', required: true }] },
      },
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    expect(created.data.slug).toBe(slug);

    const entryRes = await page.request.post(`${BASE_URL}/_admin/api/content/types/${slug}/entries`, {
      data: { slug: 'one', data: { title: 'Hello' } },
    });
    expect(entryRes.status()).toBe(201);

    const pub = await page.request.get(`${BASE_URL}/api/content/${slug}/one`);
    expect(pub.status()).toBe(200);

    const del = await page.request.delete(`${BASE_URL}/_admin/api/content/types/${created.data.id}`);
    expect(del.status()).toBe(200);
  });
});

test.describe('Content plugin UI', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('content types list and navigation with screenshots', async ({ page }, testInfo) => {
    await page.goto(`${BASE_URL}/_admin/content/types`);
    await page.waitForLoadState('load');
    await expect(page.locator('h2:has-text("Content Types")')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('cell', { name: 'hero', exact: true })).toBeVisible({ timeout: 10_000 });
    await captureStepScreenshot(page, 'content', '01-content-types-list', testInfo);

    await page.goto(`${BASE_URL}/_admin/content/types/hero/entries`);
    await page.waitForLoadState('load');
    await expect(page.locator('h2:has-text("Entries")')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('cell', { name: 'home', exact: true })).toBeVisible({ timeout: 10_000 });
    await captureStepScreenshot(page, 'content', '02-content-entries-list', testInfo);

    const entriesRes = await page.request.get(`${BASE_URL}/_admin/api/content/types/hero/entries`);
    const homeEntry = (await entriesRes.json()).data.find((e) => e.slug === 'home');
    expect(homeEntry).toBeTruthy();

    await Promise.all([
      page.goto(`${BASE_URL}/_admin/content/types/hero/entries/edit/${homeEntry.id}`),
      page.waitForResponse(
        (r) => r.url().includes(`/api/content/entries/${homeEntry.id}`) && r.ok(),
        { timeout: 20_000 }
      ),
    ]);
    await expect(page.locator('h2:has-text("Edit Entry")')).toBeVisible({ timeout: 20_000 });
    await captureStepScreenshot(page, 'content', '03-content-entry-edit', testInfo);
  });

  test('sidebar shows Content Types under CMS', async ({ page }, testInfo) => {
    await page.goto(`${BASE_URL}/_admin`);
    await page.waitForLoadState('load');
    const link = page.locator('aside a[href*="/content/types"]').first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    await captureStepScreenshot(page, 'content', '04-admin-sidebar-cms-link', testInfo);
  });
});

test.describe('Content public page', () => {
  test('renders seeded content without inline edit for anonymous users', async ({ page }, testInfo) => {
    await page.goto(`${BASE_URL}/content-demo`);
    await page.waitForLoadState('load');
    await expect(page.getByTestId('hero-headline')).toHaveText('E2E Hero Headline', { timeout: 10_000 });
    await expect(page.getByTestId('hero-body')).toContainText('E2E hero body copy');
    const html = await page.content();
    expect(html).not.toContain('ws-content-inline-edit');
    await captureStepScreenshot(page, 'content', '05-public-content-demo', testInfo);
  });

  test('opens inline edit popover, edits headline, and saves', async ({ page }, testInfo) => {
    await ensureLoggedIn(page);
    await page.goto(`${BASE_URL}/content-demo`);
    await page.waitForLoadState('load');
    await expect(page.getByTestId('hero-headline')).toContainText('E2E Hero Headline', { timeout: 10_000 });

    const editBtn = page.locator('.ws-content-edit-btn').first();
    await expect(editBtn).toBeVisible({ timeout: 10_000 });
    await editBtn.click();

    const modal = page.locator('#ws-content-modal');
    await expect(modal).toHaveClass(/is-open/);
    await expect(modal.locator('.ws-content-modal-body')).not.toContainText('Loading…', { timeout: 15_000 });

    const headlineInput = modal.locator('.ws-content-field').filter({ hasText: 'Headline' }).locator('input');
    await expect(headlineInput).toBeVisible({ timeout: 10_000 });

    const newHeadline = 'E2E Inline Edited Headline';
    await headlineInput.fill(newHeadline);
    await captureStepScreenshot(page, 'content', '06-admin-inline-edit-injected', testInfo);

    await Promise.all([
      modal.locator('[data-save="1"]').click(),
      page.waitForResponse(
        (r) => r.url().includes('/api/content/entries/') && r.request().method() === 'PUT' && r.ok(),
        { timeout: 15_000 }
      ),
    ]);
    await expect(modal).not.toHaveClass(/is-open/);
    await expect(page.getByTestId('hero-headline')).toContainText(newHeadline);

    const res = await page.request.get(`${BASE_URL}/api/content/hero/home`);
    expect((await res.json()).data.headline).toBe(newHeadline);
  });
});

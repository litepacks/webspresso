'use strict';

const path = require('path');
const { chromium } = require('@playwright/test');
const { startDocScreenshotServer } = require('./doc-admin-screenshot-server');

const OUT_DIR = path.join(__dirname, '..', 'doc', 'images', 'admin');
const ADMIN = {
  email: 'admin@docs.webspresso',
  password: 'password123',
  name: 'Docs Admin',
};

async function ensureLoggedIn(page, baseUrl) {
  await page.goto(`${baseUrl}/_admin`, { waitUntil: 'load' });
  await page.waitForSelector('h1', { timeout: 45000 });
  const heading = (await page.locator('h1').first().textContent()) || '';

  if (heading.includes('Setup Admin Account')) {
    await page.fill('input[name="name"]', ADMIN.name);
    await page.fill('input[name="email"]', ADMIN.email);
    await page.fill('input[name="password"]', ADMIN.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(_admin)?(\/)?$/, { timeout: 15000 });
  } else if (heading.includes('Admin Login')) {
    await page.fill('input[name="email"]', ADMIN.email);
    await page.fill('input[name="password"]', ADMIN.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(_admin)?(\/)?$/, { timeout: 15000 });
  }

  await page.waitForSelector('text=Admin Panel', { timeout: 15000 });
  await page.waitForTimeout(800);
}

async function shot(page, file, setup) {
  if (setup) await setup();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: true });
}

async function seedAnalytics(baseUrl) {
  for (let i = 0; i < 8; i += 1) {
    await fetch(`${baseUrl}/`);
    await fetch(`${baseUrl}/?ref=docs`);
  }
  await new Promise((r) => setTimeout(r, 3500));
}

async function run() {
  const port = Number(process.env.DOC_SCREENSHOT_PORT || 3099);
  const server = await startDocScreenshotServer(port);
  const { baseUrl } = server;

  try {
    await seedAnalytics(baseUrl);

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });

    await ensureLoggedIn(page, baseUrl);

    await shot(page, 'dashboard.png', async () => {
      await page.goto(`${baseUrl}/_admin`, { waitUntil: 'load' });
    });

    await shot(page, 'model-list.png', async () => {
      const link = page.locator('a:has-text("Test Posts"), a:has-text("TestPost")').first();
      await link.click();
      await page.waitForURL(/\/models\/TestPost/, { timeout: 15000 });
      await page.waitForSelector('table, button:has-text("New Record")', { timeout: 20000 });
    });

    await shot(page, 'bulk-actions.png', async () => {
      await page.goto(`${baseUrl}/_admin/models/TestPost`, { waitUntil: 'load' });
      await page.waitForSelector('table', { timeout: 15000 });
      await page.locator('td input[type="checkbox"]').first().click();
      await page.waitForSelector('text=/record(s)? selected/', { timeout: 10000 });
    });

    await shot(page, 'filters-drawer.png', async () => {
      await page.goto(`${baseUrl}/_admin/models/TestPost`, { waitUntil: 'load' });
      await page.click('button:has-text("All Filters")');
      await page.waitForSelector('h3:has-text("Advanced Filters")', { timeout: 10000 });
    });

    await shot(page, 'new-record.png', async () => {
      await page.goto(`${baseUrl}/_admin/models/TestPost/new`, { waitUntil: 'load' });
      await page.waitForSelector('form', { timeout: 15000 });
    });

    await shot(page, 'edit-record.png', async () => {
      await page.goto(`${baseUrl}/_admin/models/TestPost/edit/1`, { waitUntil: 'load' });
      await page.waitForSelector('form', { timeout: 15000 });
    });

    await shot(page, 'users-list.png', async () => {
      await page.getByRole('link', { name: 'All Users' }).click();
      await page.waitForURL(/\/models\/User/, { timeout: 15000 });
      await page.waitForSelector('table', { timeout: 15000 });
    });

    await shot(page, 'audit-log.png', async () => {
      const auditApi = page.waitForResponse(
        (res) => res.url().includes('/api/audit-logs') && res.status() === 200,
        { timeout: 20000 }
      );
      await page.goto(`${baseUrl}/_admin/audit-log`, { waitUntil: 'load' });
      await auditApi;
      await page.waitForSelector('table tbody tr', { timeout: 15000 });
      await page.waitForFunction(
        () => {
          const app = document.getElementById('app');
          return app && !/Loading/.test(app.innerText);
        },
        { timeout: 15000 }
      );
    });

    await shot(page, 'site-analytics.png', async () => {
      await page.goto(`${baseUrl}/_admin/analytics`, { waitUntil: 'load' });
      await page.waitForTimeout(2000);
    });

    await shot(page, 'orm-cache.png', async () => {
      await page.goto(`${baseUrl}/_admin/orm-cache`, { waitUntil: 'load' });
      await page.waitForTimeout(1200);
    });

    await browser.close();
    console.log('Admin doc screenshots saved to', OUT_DIR);
  } finally {
    if (server.app && typeof server.app.close === 'function') {
      await new Promise((resolve) => server.app.close(resolve));
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

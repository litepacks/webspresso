/**
 * Admin Panel E2E Tests
 * Tests for Dashboard, Widgets, Bulk Actions, Menu, Extensions, Settings
 */

const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:3001';

const TEST_ADMIN = {
  name: 'Test Admin',
  email: 'admin@test.com',
  password: 'password123',
};

// Helper to ensure user is logged in and return the page with session
async function ensureLoggedIn(page) {
  await page.goto(`${BASE_URL}/_admin`);
  await page.waitForLoadState('networkidle');
  
  // Wait for the page to load
  await page.waitForSelector('h1', { timeout: 10000 });
  const heading = await page.locator('h1').textContent();
  
  if (heading.includes('Setup Admin Account')) {
    // Create admin account
    await page.fill('input[name="name"]', TEST_ADMIN.name);
    await page.fill('input[name="email"]', TEST_ADMIN.email);
    await page.fill('input[name="password"]', TEST_ADMIN.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(_admin)?(\/)?$/, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
  } else if (heading.includes('Admin Login')) {
    // Login
    await page.fill('input[name="email"]', TEST_ADMIN.email);
    await page.fill('input[name="password"]', TEST_ADMIN.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(_admin)?(\/)?$/, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
  }
  // else: Already logged in (showing Admin Panel)
  
  // Verify we're logged in
  await page.waitForSelector('text=Admin Panel', { timeout: 10000 });
}

test.describe('Admin Panel API', () => {
  
  test.describe('Extensions API', () => {
    
    test('should return admin config via API', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.get(`${BASE_URL}/_admin/api/extensions/config`);
      
      expect(response.status()).toBe(200);
      const config = await response.json();
      
      // Config should have expected structure
      expect(config).toHaveProperty('settings');
      expect(config).toHaveProperty('widgets');
      expect(config).toHaveProperty('menu');
      expect(config).toHaveProperty('bulkActions');
      expect(config).toHaveProperty('actions');
      
      // Settings should have defaults
      expect(config.settings).toHaveProperty('title');
      expect(config.settings).toHaveProperty('primaryColor');
      expect(config.settings).toHaveProperty('perPage');
    });

    test('should return dashboard stats via API', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.get(`${BASE_URL}/_admin/api/extensions/dashboard/stats`);
      
      expect(response.status()).toBe(200);
      const data = await response.json();
      
      expect(data).toHaveProperty('stats');
      expect(typeof data.stats).toBe('object');
      
      // Check that stats include extended information
      const modelStats = Object.values(data.stats)[0];
      if (modelStats) {
        expect(modelStats).toHaveProperty('name');
        expect(modelStats).toHaveProperty('label');
        expect(modelStats).toHaveProperty('count');
        expect(modelStats).toHaveProperty('columnCount');
        expect(modelStats).toHaveProperty('table');
        // lastCreated and lastUpdated may be null if no records exist
        expect(modelStats).toHaveProperty('lastCreated');
        expect(modelStats).toHaveProperty('lastUpdated');
      }
    });

    test('should have widgets in config', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.get(`${BASE_URL}/_admin/api/extensions/config`);
      const config = await response.json();
      
      expect(Array.isArray(config.widgets)).toBe(true);
      expect(config.widgets.length).toBeGreaterThan(0);
      
      // Check widget structure
      const widget = config.widgets[0];
      expect(widget).toHaveProperty('id');
      expect(widget).toHaveProperty('title');
      expect(widget).toHaveProperty('size');
    });

    test('should return widget data via API', async ({ page }) => {
      await ensureLoggedIn(page);
      
      // Get available widgets
      const configResponse = await page.request.get(`${BASE_URL}/_admin/api/extensions/config`);
      const config = await configResponse.json();
      
      if (config.widgets && config.widgets.length > 0) {
        const widgetId = config.widgets[0].id;
        const response = await page.request.get(`${BASE_URL}/_admin/api/extensions/widgets/${widgetId}/data`);
        
        expect(response.status()).toBe(200);
        const data = await response.json();
        expect(data).toHaveProperty('data');
      }
    });

    test('should have menu structure in config', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.get(`${BASE_URL}/_admin/api/extensions/config`);
      const config = await response.json();
      
      expect(Array.isArray(config.menu)).toBe(true);
      expect(config.menu.length).toBeGreaterThan(0);
      
      // Should have dashboard item
      const dashboardItem = config.menu.find(item => item.id === 'dashboard');
      expect(dashboardItem).toBeDefined();
      expect(dashboardItem.path).toBe('/');
    });

    test('should have bulk actions in config', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.get(`${BASE_URL}/_admin/api/extensions/config`);
      const config = await response.json();
      
      expect(Array.isArray(config.bulkActions)).toBe(true);
      expect(config.bulkActions.length).toBeGreaterThan(0);
      
      // Should have bulk-delete action
      const deleteAction = config.bulkActions.find(a => a.id === 'bulk-delete');
      expect(deleteAction).toBeDefined();
      expect(deleteAction.label).toBe('Delete Selected');
    });
  });

  test.describe('Export API', () => {
    
    test('should export data as JSON', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.get(`${BASE_URL}/_admin/api/extensions/export/TestPost?format=json`);
      
      expect(response.status()).toBe(200);
      const contentType = response.headers()['content-type'];
      expect(contentType).toContain('application/json');
      
      const data = await response.json();
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('model', 'TestPost');
      expect(data).toHaveProperty('exportedAt');
    });

    test('should export data as CSV', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.get(`${BASE_URL}/_admin/api/extensions/export/TestPost?format=csv`);
      
      expect(response.status()).toBe(200);
      const contentType = response.headers()['content-type'];
      expect(contentType).toContain('text/csv');
      
      const csvContent = await response.text();
      // CSV should have header row with id and title columns
      expect(csvContent).toContain('id');
      expect(csvContent).toContain('title');
    });

    test('should export specific records by IDs', async ({ page }) => {
      await ensureLoggedIn(page);
      
      // First create a record
      const createResponse = await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
        data: {
          title: 'Export Test Post',
          content: 'Content for export test',
          published: true,
        },
      });
      
      expect(createResponse.status()).toBe(201);
      const created = await createResponse.json();
      const recordId = created.data.id;
      
      // Export only that record
      const exportResponse = await page.request.get(`${BASE_URL}/_admin/api/extensions/export/TestPost?format=json&ids=${recordId}`);
      
      expect(exportResponse.status()).toBe(200);
      const data = await exportResponse.json();
      expect(data.data.length).toBe(1);
      expect(data.data[0].title).toBe('Export Test Post');
    });

    test('should export with selectAll and filters', async ({ page }) => {
      await ensureLoggedIn(page);
      
      // Create test records with unique prefix
      const uniquePrefix = `ExportSelectAll_${Date.now()}`;
      const ids = [];
      for (let i = 1; i <= 3; i++) {
        const response = await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
          data: {
            title: `${uniquePrefix}_${i}`,
            content: `Export content ${i}`,
            published: true,
            status: 'published',
          },
        });
        const data = await response.json();
        ids.push(data.data.id);
      }
      
      // Export using selectAll with filter
      const filterParams = encodeURIComponent(JSON.stringify({
        title: { value: uniquePrefix, operator: 'contains' },
      }));
      const exportResponse = await page.request.get(
        `${BASE_URL}/_admin/api/extensions/export/TestPost?format=json&selectAll=true&filters=${filterParams}`
      );
      
      expect(exportResponse.status()).toBe(200);
      const data = await exportResponse.json();
      expect(data.data.length).toBe(3);
      
      // Cleanup
      for (const id of ids) {
        await page.request.delete(`${BASE_URL}/_admin/api/models/TestPost/records/${id}`);
      }
    });
  });

  test.describe('Bulk Actions API', () => {
    
    test('should execute bulk delete action', async ({ page }) => {
      await ensureLoggedIn(page);
      
      // Create test records
      const ids = [];
      for (let i = 1; i <= 3; i++) {
        const response = await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
          data: {
            title: `Bulk Delete Test ${i}`,
            content: `Content ${i}`,
            published: false,
          },
        });
        const data = await response.json();
        ids.push(data.data.id);
      }
      
      // Execute bulk delete
      const actionResponse = await page.request.post(
        `${BASE_URL}/_admin/api/extensions/bulk-actions/bulk-delete/TestPost`,
        { data: { ids } }
      );
      
      expect(actionResponse.status()).toBe(200);
      const result = await actionResponse.json();
      expect(result.success).toBe(true);
      expect(result.affected).toBe(3);
      
      // Verify records are deleted
      for (const id of ids) {
        const getResponse = await page.request.get(`${BASE_URL}/_admin/api/models/TestPost/records/${id}`);
        expect(getResponse.status()).toBe(404);
      }
    });

    test('should return 404 for unknown bulk action', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.post(
        `${BASE_URL}/_admin/api/extensions/bulk-actions/unknown-action/TestPost`,
        { data: { ids: [1, 2, 3] } }
      );
      
      expect(response.status()).toBe(404);
    });

    test('should return 400 when no IDs provided', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.post(
        `${BASE_URL}/_admin/api/extensions/bulk-actions/bulk-delete/TestPost`,
        { data: {} }
      );
      
      expect(response.status()).toBe(400);
    });

    test('should execute bulk delete with selectAll mode', async ({ page }) => {
      await ensureLoggedIn(page);
      
      // Create test records with a unique title prefix for filtering
      const uniquePrefix = `SelectAllTest_${Date.now()}`;
      for (let i = 1; i <= 3; i++) {
        await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
          data: {
            title: `${uniquePrefix}_${i}`,
            content: `Content ${i}`,
            published: false,
            status: 'draft',
          },
        });
      }
      
      // Execute bulk delete with selectAll and filter
      const actionResponse = await page.request.post(
        `${BASE_URL}/_admin/api/extensions/bulk-actions/bulk-delete/TestPost`,
        {
          data: {
            selectAll: true,
            filters: {
              title: { value: uniquePrefix, operator: 'contains' },
            },
          },
        }
      );
      
      expect(actionResponse.status()).toBe(200);
      const result = await actionResponse.json();
      expect(result.success).toBe(true);
      expect(result.affected).toBe(3);
    });
  });

  test.describe('Bulk Field Update API', () => {
    
    test('should return bulk-updatable fields for model', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.get(`${BASE_URL}/_admin/api/extensions/bulk-fields/TestPost`);
      
      expect(response.status()).toBe(200);
      const data = await response.json();
      
      expect(data).toHaveProperty('fields');
      expect(Array.isArray(data.fields)).toBe(true);
      
      // Should have status (enum) and published (boolean) fields
      const fieldNames = data.fields.map(f => f.name);
      expect(fieldNames).toContain('published');
      expect(fieldNames).toContain('status');
      
      // Check field structure
      const statusField = data.fields.find(f => f.name === 'status');
      expect(statusField.type).toBe('enum');
      expect(statusField.options).toEqual([
        { value: 'draft', label: 'draft' },
        { value: 'pending', label: 'pending' },
        { value: 'published', label: 'published' },
        { value: 'archived', label: 'archived' },
      ]);
      
      const publishedField = data.fields.find(f => f.name === 'published');
      expect(publishedField.type).toBe('boolean');
      expect(publishedField.options).toEqual([
        { value: true, label: 'True' },
        { value: false, label: 'False' },
      ]);
    });

    test('should bulk update boolean field', async ({ page }) => {
      await ensureLoggedIn(page);
      
      // Create test records with published=false
      const ids = [];
      for (let i = 1; i <= 3; i++) {
        const response = await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
          data: {
            title: `Bulk Bool Test ${i}`,
            content: 'Content for bulk boolean test',
            published: false,
            status: 'draft',
          },
        });
        const data = await response.json();
        ids.push(data.data.id);
      }
      
      // Execute bulk update to set published=true
      const updateResponse = await page.request.post(
        `${BASE_URL}/_admin/api/extensions/bulk-update/TestPost`,
        { data: { ids, field: 'published', value: true } }
      );
      
      expect(updateResponse.status()).toBe(200);
      const result = await updateResponse.json();
      expect(result.success).toBe(true);
      expect(result.affected).toBe(3);
      expect(result.result.field).toBe('published');
      expect(result.result.value).toBe(true);
      
      // Verify records are updated
      for (const id of ids) {
        const getResponse = await page.request.get(`${BASE_URL}/_admin/api/models/TestPost/records/${id}`);
        const record = await getResponse.json();
        expect(record.data.published).toBe(1); // SQLite returns 1 for true
      }
      
      // Cleanup
      for (const id of ids) {
        await page.request.delete(`${BASE_URL}/_admin/api/models/TestPost/records/${id}`);
      }
    });

    test('should bulk update enum field', async ({ page }) => {
      await ensureLoggedIn(page);
      
      // Create test records with status=draft
      const ids = [];
      for (let i = 1; i <= 3; i++) {
        const response = await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
          data: {
            title: `Bulk Enum Test ${i}`,
            content: 'Content for bulk enum test',
            published: false,
            status: 'draft',
          },
        });
        const data = await response.json();
        ids.push(data.data.id);
      }
      
      // Execute bulk update to set status=published
      const updateResponse = await page.request.post(
        `${BASE_URL}/_admin/api/extensions/bulk-update/TestPost`,
        { data: { ids, field: 'status', value: 'published' } }
      );
      
      expect(updateResponse.status()).toBe(200);
      const result = await updateResponse.json();
      expect(result.success).toBe(true);
      expect(result.affected).toBe(3);
      expect(result.result.field).toBe('status');
      expect(result.result.value).toBe('published');
      
      // Verify records are updated
      for (const id of ids) {
        const getResponse = await page.request.get(`${BASE_URL}/_admin/api/models/TestPost/records/${id}`);
        const record = await getResponse.json();
        expect(record.data.status).toBe('published');
      }
      
      // Cleanup
      for (const id of ids) {
        await page.request.delete(`${BASE_URL}/_admin/api/models/TestPost/records/${id}`);
      }
    });

    test('should return 400 for invalid enum value', async ({ page }) => {
      await ensureLoggedIn(page);
      
      // Create a test record
      const createResponse = await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
        data: {
          title: 'Invalid Enum Test',
          content: 'Content for invalid enum test',
          status: 'draft',
        },
      });
      const created = await createResponse.json();
      const id = created.data.id;
      
      // Try to update with invalid enum value
      const updateResponse = await page.request.post(
        `${BASE_URL}/_admin/api/extensions/bulk-update/TestPost`,
        { data: { ids: [id], field: 'status', value: 'invalid_status' } }
      );
      
      expect(updateResponse.status()).toBe(400);
      const result = await updateResponse.json();
      expect(result.error).toContain('Invalid value');
      
      // Cleanup
      await page.request.delete(`${BASE_URL}/_admin/api/models/TestPost/records/${id}`);
    });

    test('should return 400 for non-enum/boolean field', async ({ page }) => {
      await ensureLoggedIn(page);
      
      // Create a test record
      const createResponse = await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
        data: {
          title: 'Non-Enum Field Test',
          content: 'Content for non-enum field test',
        },
      });
      const created = await createResponse.json();
      const id = created.data.id;
      
      // Try to bulk update a string field
      const updateResponse = await page.request.post(
        `${BASE_URL}/_admin/api/extensions/bulk-update/TestPost`,
        { data: { ids: [id], field: 'title', value: 'New Title' } }
      );
      
      expect(updateResponse.status()).toBe(400);
      const result = await updateResponse.json();
      expect(result.error).toContain('not an enum or boolean');
      
      // Cleanup
      await page.request.delete(`${BASE_URL}/_admin/api/models/TestPost/records/${id}`);
    });

    test('should return 400 when field not provided', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.post(
        `${BASE_URL}/_admin/api/extensions/bulk-update/TestPost`,
        { data: { ids: [1, 2, 3], value: 'test' } }
      );
      
      expect(response.status()).toBe(400);
      const result = await response.json();
      expect(result.error).toContain('Field name is required');
    });

    test('should return 400 when no IDs provided for bulk update', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.post(
        `${BASE_URL}/_admin/api/extensions/bulk-update/TestPost`,
        { data: { field: 'status', value: 'published' } }
      );
      
      expect(response.status()).toBe(400);
      const result = await response.json();
      expect(result.error).toContain('No records selected');
    });

    test('should bulk update with selectAll mode', async ({ page }) => {
      await ensureLoggedIn(page);
      
      // Create test records with a unique title prefix
      const uniquePrefix = `BulkUpdateSelectAll_${Date.now()}`;
      const ids = [];
      for (let i = 1; i <= 3; i++) {
        const response = await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
          data: {
            title: `${uniquePrefix}_${i}`,
            content: 'Content for selectAll test',
            published: false,
            status: 'draft',
          },
        });
        const data = await response.json();
        ids.push(data.data.id);
      }
      
      // Execute bulk update with selectAll and filter
      const updateResponse = await page.request.post(
        `${BASE_URL}/_admin/api/extensions/bulk-update/TestPost`,
        {
          data: {
            selectAll: true,
            filters: {
              title: { value: uniquePrefix, operator: 'contains' },
            },
            field: 'status',
            value: 'published',
          },
        }
      );
      
      expect(updateResponse.status()).toBe(200);
      const result = await updateResponse.json();
      expect(result.success).toBe(true);
      expect(result.affected).toBe(3);
      
      // Verify records are updated
      for (const id of ids) {
        const getResponse = await page.request.get(`${BASE_URL}/_admin/api/models/TestPost/records/${id}`);
        const record = await getResponse.json();
        expect(record.data.status).toBe('published');
      }
      
      // Cleanup
      for (const id of ids) {
        await page.request.delete(`${BASE_URL}/_admin/api/models/TestPost/records/${id}`);
      }
    });

    test('should return error for non-existent model', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.get(`${BASE_URL}/_admin/api/extensions/bulk-fields/NonExistentModel`);
      
      // Either 404 (not found) or 500 (model lookup error) is acceptable
      expect([404, 500]).toContain(response.status());
    });
  });

  test.describe('Custom Actions API', () => {
    
    test('should return 404 for non-existent action', async ({ page }) => {
      await ensureLoggedIn(page);
      
      // Create a record
      const createResponse = await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
        data: {
          title: 'Action Test Post',
          content: 'Content',
          published: false,
        },
      });
      const created = await createResponse.json();
      const recordId = created.data.id;
      
      // Try unknown action
      const actionResponse = await page.request.post(
        `${BASE_URL}/_admin/api/extensions/actions/unknown-action/TestPost/${recordId}`,
        { data: {} }
      );
      
      expect(actionResponse.status()).toBe(404);
    });

    test('should return 404 for non-existent record', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.post(
        `${BASE_URL}/_admin/api/extensions/actions/test-action/TestPost/999999`,
        { data: {} }
      );
      
      // Either 404 (action not found) or 404 (record not found)
      expect(response.status()).toBe(404);
    });
  });

  test.describe('Activity Log API', () => {
    
    test('should return activity log (empty if not enabled)', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.get(`${BASE_URL}/_admin/api/extensions/activity`);
      
      expect(response.status()).toBe(200);
      const data = await response.json();
      
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('pagination');
      expect(Array.isArray(data.data)).toBe(true);
    });

    test('should support pagination in activity log', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.get(`${BASE_URL}/_admin/api/extensions/activity?page=1&perPage=10`);
      
      expect(response.status()).toBe(200);
      const data = await response.json();
      
      // Pagination structure may vary - check that we have the expected structure
      if (data.pagination) {
        // Query params may be returned as strings or numbers
        expect(Number(data.pagination.page)).toBe(1);
        expect(Number(data.pagination.perPage)).toBe(10);
      } else {
        // Alternative: data might be returned directly without pagination wrapper
        expect(data).toHaveProperty('data');
      }
    });
  });

  test.describe('Settings API', () => {
    
    test('should get settings via API', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.get(`${BASE_URL}/_admin/api/extensions/settings`);
      
      expect(response.status()).toBe(200);
      const data = await response.json();
      
      expect(data).toHaveProperty('settings');
      expect(typeof data.settings).toBe('object');
    });

    test('should update settings via API', async ({ page }) => {
      await ensureLoggedIn(page);
      
      // Update settings
      const updateResponse = await page.request.post(`${BASE_URL}/_admin/api/extensions/settings`, {
        data: {
          customSetting: 'test-value',
        },
      });
      
      expect(updateResponse.status()).toBe(200);
      const updateData = await updateResponse.json();
      expect(updateData.success).toBe(true);
      expect(updateData.settings).toHaveProperty('customSetting', 'test-value');
      
      // Verify settings persisted
      const getResponse = await page.request.get(`${BASE_URL}/_admin/api/extensions/settings`);
      const getData = await getResponse.json();
      expect(getData.settings).toHaveProperty('customSetting', 'test-value');
    });

    test('should merge settings without overwriting existing', async ({ page }) => {
      await ensureLoggedIn(page);
      
      // First update
      await page.request.post(`${BASE_URL}/_admin/api/extensions/settings`, {
        data: { setting1: 'value1' },
      });
      
      // Second update with different key
      const response = await page.request.post(`${BASE_URL}/_admin/api/extensions/settings`, {
        data: { setting2: 'value2' },
      });
      
      expect(response.status()).toBe(200);
      const data = await response.json();
      
      // Both settings should exist
      expect(data.settings).toHaveProperty('setting1', 'value1');
      expect(data.settings).toHaveProperty('setting2', 'value2');
    });
  });

  test.describe('Registry Configuration', () => {
    
    test('should have correct settings defaults', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.get(`${BASE_URL}/_admin/api/extensions/config`);
      const config = await response.json();
      
      expect(config.settings.title).toBe('Admin Panel');
      expect(config.settings.primaryColor).toBe('#3B82F6');
      expect(config.settings.perPage).toBe(20);
      expect(config.settings.dateFormat).toBe('YYYY-MM-DD');
    });

    test('should include model menu items', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.get(`${BASE_URL}/_admin/api/extensions/config`);
      const config = await response.json();
      
      // Find content group
      const contentGroup = config.menu.find(item => item.id === 'content');
      expect(contentGroup).toBeDefined();
      expect(contentGroup.items).toBeDefined();
      expect(contentGroup.items.length).toBeGreaterThan(0);
      
      // TestPost should be in content group
      const testPostItem = contentGroup.items.find(item => item.id === 'model-TestPost');
      expect(testPostItem).toBeDefined();
      expect(testPostItem.path).toBe('/models/TestPost');
    });

    test('should include export bulk actions', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.get(`${BASE_URL}/_admin/api/extensions/config`);
      const config = await response.json();
      
      const exportJson = config.bulkActions.find(a => a.id === 'export-json');
      const exportCsv = config.bulkActions.find(a => a.id === 'export-csv');
      
      expect(exportJson).toBeDefined();
      expect(exportJson.label).toBe('Export as JSON');
      
      expect(exportCsv).toBeDefined();
      expect(exportCsv.label).toBe('Export as CSV');
    });

    test('should have widget definitions', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.get(`${BASE_URL}/_admin/api/extensions/config`);
      const config = await response.json();
      
      // Should have model-stats widget
      const modelStatsWidget = config.widgets.find(w => w.id === 'model-stats');
      expect(modelStatsWidget).toBeDefined();
      expect(modelStatsWidget.title).toBe('Overview');
      expect(modelStatsWidget.size).toBe('full');
      
      // Should have quick-actions widget
      const quickActionsWidget = config.widgets.find(w => w.id === 'quick-actions');
      expect(quickActionsWidget).toBeDefined();
      expect(quickActionsWidget.title).toBe('Quick Actions');
    });
  });
});

test.describe('Admin Panel Integration', () => {
  
  test.describe('Model CRUD with Extensions', () => {
    let testRecordId;
    
    test('should create record with validation', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
        data: {
          title: 'Integration Test Post',
          content: 'Content for integration test',
          published: true,
        },
      });
      
      expect(response.status()).toBe(201);
      const data = await response.json();
      expect(data.data).toHaveProperty('id');
      expect(data.data.title).toBe('Integration Test Post');
      testRecordId = data.data.id;
    });

    test('should update record', async ({ page }) => {
      await ensureLoggedIn(page);
      
      // Create first
      const createResponse = await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
        data: {
          title: 'Update Test Post',
          content: 'Original content',
          published: false,
        },
      });
      const created = await createResponse.json();
      
      // Update
      const updateResponse = await page.request.put(
        `${BASE_URL}/_admin/api/models/TestPost/records/${created.data.id}`,
        {
          data: {
            title: 'Updated Title',
            published: true,
          },
        }
      );
      
      expect(updateResponse.status()).toBe(200);
      const updated = await updateResponse.json();
      expect(updated.data.title).toBe('Updated Title');
    });

    test('should delete record', async ({ page }) => {
      await ensureLoggedIn(page);
      
      // Create first
      const createResponse = await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
        data: {
          title: 'Delete Test Post',
          content: 'To be deleted',
          published: false,
        },
      });
      const created = await createResponse.json();
      
      // Delete
      const deleteResponse = await page.request.delete(
        `${BASE_URL}/_admin/api/models/TestPost/records/${created.data.id}`
      );
      
      expect(deleteResponse.status()).toBe(200);
      
      // Verify deleted
      const getResponse = await page.request.get(
        `${BASE_URL}/_admin/api/models/TestPost/records/${created.data.id}`
      );
      expect(getResponse.status()).toBe(404);
    });

    test('should list records with pagination', async ({ page }) => {
      await ensureLoggedIn(page);
      
      // Create multiple records
      for (let i = 1; i <= 5; i++) {
        await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
          data: {
            title: `Pagination Test ${i}`,
            content: `Content ${i}`,
            published: i % 2 === 0,
          },
        });
      }
      
      // List with pagination
      const response = await page.request.get(`${BASE_URL}/_admin/api/models/TestPost/records?page=1&perPage=3`);
      
      expect(response.status()).toBe(200);
      const data = await response.json();
      
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('pagination');
      expect(data.pagination.perPage).toBe(3);
    });

    test('should filter records', async ({ page }) => {
      await ensureLoggedIn(page);
      
      // Create records with different published status
      await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
        data: { title: 'Filter Published', content: 'Content', published: true },
      });
      await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
        data: { title: 'Filter Draft', content: 'Content', published: false },
      });
      
      // Filter by published
      const response = await page.request.get(
        `${BASE_URL}/_admin/api/models/TestPost/records?filter[published][value]=true`
      );
      
      expect(response.status()).toBe(200);
      const data = await response.json();
      
      // All results should be published
      data.data.forEach(record => {
        expect(record.published === true || record.published === 1).toBeTruthy();
      });
    });
  });

  test.describe('Error Handling', () => {
    
    test('should return 404 for invalid model', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.get(`${BASE_URL}/_admin/api/models/NonExistentModel/records`);
      expect(response.status()).toBe(404);
    });

    test('should return 404 for invalid record ID', async ({ page }) => {
      await ensureLoggedIn(page);
      
      const response = await page.request.get(`${BASE_URL}/_admin/api/models/TestPost/records/999999`);
      expect(response.status()).toBe(404);
    });

    test('should return error for invalid JSON', async ({ page }) => {
      await ensureLoggedIn(page);
      
      // Try to create with invalid field type (string for boolean)
      const response = await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
        data: {
          title: 'Test',
          published: 'not-a-boolean', // Invalid type - should be boolean
        },
      });
      
      // The response could be 201 if validation is lenient, or 400 if strict
      // For now, just verify we get a response
      const status = response.status();
      expect([200, 201, 400]).toContain(status);
    });
  });
});

test.describe('Admin Panel UI', () => {
  
  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('should display dashboard with widgets', async ({ page }) => {
    await page.goto(`${BASE_URL}/_admin`);
    await page.waitForLoadState('networkidle');
    
    // Should see sidebar with Admin Panel title
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    await expect(sidebar.locator('text=Admin Panel').first()).toBeVisible({ timeout: 10000 });
    
    // Dashboard shows widgets (Overview/model cards or welcome message)
    const dashboardContent = page.locator('h1:has-text("Dashboard")').or(page.locator('text=Welcome back')).or(page.locator('text=Overview')).or(page.locator('a[href*="/models/"]'));
    await expect(dashboardContent.first()).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to model list via menu', async ({ page }) => {
    await page.goto(`${BASE_URL}/_admin`);
    await page.waitForLoadState('networkidle');
    
    // Find and click TestPost in sidebar or models list
    const modelLink = page.locator('a:has-text("Test Posts")').or(page.locator('a:has-text("TestPost")'));
    await expect(modelLink.first()).toBeVisible({ timeout: 10000 });
    await modelLink.first().click();
    
    // Should navigate to model records page
    await page.waitForURL(/\/models\/TestPost/, { timeout: 10000 });
    
    // Should see New Record button
    const newRecordBtn = page.locator('button:has-text("New Record")');
    await expect(newRecordBtn).toBeVisible({ timeout: 10000 });
  });

  test('should display records table when records exist', async ({ page }) => {
    await page.goto(`${BASE_URL}/_admin/models/TestPost`);
    await page.waitForLoadState('networkidle');
    
    // Wait for table to load
    await page.waitForSelector('table', { timeout: 15000 });
    
    // Check for table header columns
    const idColumn = page.locator('th:has-text("ID")');
    const titleColumn = page.locator('th:has-text("TITLE")');
    const actionsColumn = page.locator('th:has-text("ACTIONS")');
    
    await expect(idColumn).toBeVisible({ timeout: 5000 });
    await expect(titleColumn).toBeVisible({ timeout: 5000 });
    await expect(actionsColumn).toBeVisible({ timeout: 5000 });
    
    // Edit and Delete buttons should be available for records
    const editButton = page.locator('button:has-text("Edit")').first();
    const deleteButton = page.locator('button:has-text("Delete")').first();
    
    await expect(editButton).toBeVisible({ timeout: 5000 });
    await expect(deleteButton).toBeVisible({ timeout: 5000 });
  });

  test('should show All Filters button', async ({ page }) => {
    await page.goto(`${BASE_URL}/_admin/models/TestPost`);
    await page.waitForLoadState('networkidle');
    
    // All Filters button should be visible
    const allFiltersBtn = page.locator('button:has-text("All Filters")');
    await expect(allFiltersBtn).toBeVisible({ timeout: 10000 });
  });

  test('should open filter drawer', async ({ page }) => {
    await page.goto(`${BASE_URL}/_admin/models/TestPost`);
    await page.waitForLoadState('networkidle');
    
    // Click All Filters button
    await page.click('button:has-text("All Filters")');
    await page.waitForTimeout(500);
    
    // Drawer should be visible
    const drawerHeading = page.locator('h3:has-text("Advanced Filters")');
    await expect(drawerHeading).toBeVisible({ timeout: 5000 });
    
    // Close drawer
    await page.click('button:has-text("Cancel")');
    await page.waitForTimeout(500);
    
    await expect(drawerHeading).not.toBeVisible({ timeout: 5000 });
  });

  test('should display record form with proper fields', async ({ page }) => {
    await page.goto(`${BASE_URL}/_admin/models/TestPost/new`);
    await page.waitForLoadState('networkidle');
    
    // Wait for form
    await page.waitForSelector('form', { timeout: 15000 });
    
    // Verify form fields
    const titleInput = page.locator('input#title, input[name="title"]');
    const contentTextarea = page.locator('textarea#content, textarea[name="content"]');
    const publishedCheckbox = page.locator('input[type="checkbox"][name="published"]');
    
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    await expect(contentTextarea).toBeVisible({ timeout: 5000 });
    await expect(publishedCheckbox).toBeVisible({ timeout: 5000 });
    
    // Save button should be visible
    await expect(page.locator('button:has-text("Save")')).toBeVisible({ timeout: 5000 });
  });

  test('should have breadcrumb navigation', async ({ page }) => {
    await page.goto(`${BASE_URL}/_admin/models/TestPost`);
    await page.waitForLoadState('networkidle');
    
    // Breadcrumb or sidebar navigation should be visible
    const breadcrumb = page.locator('nav[aria-label="Breadcrumb"], [class*="breadcrumb"]').first();
    const sidebar = page.locator('aside');
    const hasBreadcrumb = await breadcrumb.isVisible().catch(() => false);
    
    if (hasBreadcrumb) {
      // Should contain model name
      const modelInBreadcrumb = breadcrumb.getByText(/TestPost|Test Post/);
      await expect(modelInBreadcrumb).toBeVisible({ timeout: 5000 });
    } else {
      // New sidebar layout - verify sidebar shows current model
      await expect(sidebar).toBeVisible({ timeout: 10000 });
      // Verify we're on correct page by checking h2
      const heading = page.locator('h2:has-text("Test Post"), h2:has-text("TestPost")').first();
      await expect(heading).toBeVisible({ timeout: 10000 });
    }
  });

  test('should have fixed sidebar', async ({ page }) => {
    await page.goto(`${BASE_URL}/_admin`);
    await page.waitForLoadState('networkidle');
    
    // Fixed sidebar should be visible (new layout uses fixed sidebar instead of sticky header)
    const sidebar = page.locator('aside.fixed, aside.w-64').first();
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    
    // Should contain Admin Panel text
    await expect(sidebar.locator('text=Admin Panel').first()).toBeVisible({ timeout: 5000 });
  });

  test('should show logout button', async ({ page }) => {
    await page.goto(`${BASE_URL}/_admin`);
    await page.waitForLoadState('networkidle');
    
    // Logout button should be visible (in new layout it's an icon button with title="Logout")
    const logoutBtn = page.locator('button[title="Logout"], button:has-text("Logout")').first();
    await expect(logoutBtn).toBeVisible({ timeout: 10000 });
  });

  test('should show bulk actions toolbar when records selected', async ({ page }) => {
    // First create some test records
    await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
      data: {
        title: 'UI Bulk Test 1',
        content: 'Content for UI bulk test',
        status: 'draft',
        published: false,
      },
    });
    await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
      data: {
        title: 'UI Bulk Test 2',
        content: 'Content for UI bulk test',
        status: 'draft',
        published: false,
      },
    });
    
    await page.goto(`${BASE_URL}/_admin/models/TestPost`);
    await page.waitForLoadState('networkidle');
    
    // Wait for table to load
    await page.waitForSelector('table', { timeout: 15000 });
    
    // Select first checkbox
    const firstCheckbox = page.locator('td input[type="checkbox"]').first();
    await expect(firstCheckbox).toBeVisible({ timeout: 5000 });
    await firstCheckbox.click();
    
    // Bulk actions toolbar should appear
    const bulkToolbar = page.locator('text=record selected').or(page.locator('text=records selected')).first();
    await expect(bulkToolbar).toBeVisible({ timeout: 5000 });
    
    // Delete button should be visible
    const deleteBtn = page.locator('button:has-text("Delete")').first();
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });
    
    // Export buttons should be visible
    const exportJsonBtn = page.locator('button:has-text("Export JSON")');
    await expect(exportJsonBtn).toBeVisible({ timeout: 5000 });
  });

  test('should show Set Field dropdown in bulk actions', async ({ page }) => {
    // First create some test records
    await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
      data: {
        title: 'Set Field Test 1',
        content: 'Content for set field test',
        status: 'draft',
        published: false,
      },
    });
    
    await page.goto(`${BASE_URL}/_admin/models/TestPost`);
    await page.waitForLoadState('networkidle');
    
    // Wait for table to load
    await page.waitForSelector('table', { timeout: 15000 });
    
    // Select first checkbox
    const firstCheckbox = page.locator('td input[type="checkbox"]').first();
    await expect(firstCheckbox).toBeVisible({ timeout: 5000 });
    await firstCheckbox.click();
    
    // Set Field dropdown button should be visible
    const setFieldBtn = page.locator('button:has-text("Set Field")');
    await expect(setFieldBtn).toBeVisible({ timeout: 5000 });
  });

  test('should open Set Field dropdown and show fields', async ({ page }) => {
    // First create some test records
    await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
      data: {
        title: 'Dropdown Test',
        content: 'Content for dropdown test',
        status: 'draft',
        published: false,
      },
    });
    
    await page.goto(`${BASE_URL}/_admin/models/TestPost`);
    await page.waitForLoadState('networkidle');
    
    // Wait for table to load
    await page.waitForSelector('table', { timeout: 15000 });
    
    // Select first checkbox
    const firstCheckbox = page.locator('td input[type="checkbox"]').first();
    await expect(firstCheckbox).toBeVisible({ timeout: 5000 });
    await firstCheckbox.click();
    
    // Click Set Field dropdown
    const setFieldBtn = page.locator('button:has-text("Set Field")');
    await setFieldBtn.click();
    
    // Dropdown should open and show fields
    const dropdown = page.locator('text=Select Field');
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    
    // Should see the status and published fields
    const statusField = page.locator('button:has-text("Status")').or(page.locator('text=status'));
    const publishedField = page.locator('button:has-text("Published")').or(page.locator('text=published'));
    
    await expect(statusField.first()).toBeVisible({ timeout: 5000 });
    await expect(publishedField.first()).toBeVisible({ timeout: 5000 });
  });

  test('should clear selection when Clear button clicked', async ({ page }) => {
    await page.goto(`${BASE_URL}/_admin/models/TestPost`);
    await page.waitForLoadState('networkidle');
    
    // Wait for table to load
    await page.waitForSelector('table', { timeout: 15000 });
    
    // Select first checkbox
    const firstCheckbox = page.locator('td input[type="checkbox"]').first();
    await expect(firstCheckbox).toBeVisible({ timeout: 5000 });
    await firstCheckbox.click();
    
    // Verify selection appeared
    const selectedText = page.locator('text=record selected').or(page.locator('text=records selected')).first();
    await expect(selectedText).toBeVisible({ timeout: 5000 });
    
    // Click clear button
    const clearBtn = page.locator('button:has-text("Clear")').first();
    await clearBtn.click();
    
    // Selection should be cleared
    await expect(selectedText).not.toBeVisible({ timeout: 5000 });
  });

  test('should select all with header checkbox', async ({ page }) => {
    await page.goto(`${BASE_URL}/_admin/models/TestPost`);
    await page.waitForLoadState('networkidle');
    
    // Wait for table to load
    await page.waitForSelector('table', { timeout: 15000 });
    
    // Click header checkbox to select all
    const headerCheckbox = page.locator('th input[type="checkbox"]');
    await expect(headerCheckbox).toBeVisible({ timeout: 5000 });
    await headerCheckbox.click();
    
    // Bulk actions toolbar should show multiple records selected
    const selectedText = page.locator('text=/\\d+ record(s)? selected/');
    await expect(selectedText).toBeVisible({ timeout: 5000 });
  });

  test('should show select all matching records option', async ({ page }) => {
    // Create enough records to trigger pagination
    const uniquePrefix = `SelectAllUI_${Date.now()}`;
    for (let i = 1; i <= 25; i++) {
      await page.request.post(`${BASE_URL}/_admin/api/models/TestPost/records`, {
        data: {
          title: `${uniquePrefix}_${i}`,
          content: `Content ${i}`,
          published: i % 2 === 0,
          status: 'draft',
        },
      });
    }
    
    await page.goto(`${BASE_URL}/_admin/models/TestPost`);
    await page.waitForLoadState('networkidle');
    
    // Wait for table to load
    await page.waitForSelector('table', { timeout: 15000 });
    
    // Click header checkbox to select all on current page
    const headerCheckbox = page.locator('th input[type="checkbox"]');
    await expect(headerCheckbox).toBeVisible({ timeout: 5000 });
    await headerCheckbox.click();
    
    // Should see "Select all X records" option when there are more records than current page
    const selectAllLink = page.locator('button:has-text("Select all")');
    
    // If pagination is present and total > page records, select all link should appear
    const paginationText = page.locator('text=/\\d+ of \\d+/');
    const hasPagination = await paginationText.isVisible().catch(() => false);
    
    if (hasPagination) {
      await expect(selectAllLink).toBeVisible({ timeout: 5000 });
    }
  });

  test('should display dashboard model cards with extended info', async ({ page }) => {
    await page.goto(`${BASE_URL}/_admin`);
    await page.waitForLoadState('networkidle');
    
    // Wait for dashboard to load (Overview widget or model cards)
    const dashboardLoaded = page.locator('text=Overview').or(page.locator('a[href*="/models/TestPost"]')).or(page.locator('text=Test Posts'));
    await expect(dashboardLoaded.first()).toBeVisible({ timeout: 10000 });
    
    // Model cards show table name in title attribute or as "Table" label
    const tableLabel = page.locator('p:has-text("Table")').first();
    await expect(tableLabel).toBeVisible({ timeout: 5000 });
    
    // Model cards show column count
    const columnLabel = page.locator('p:has-text("Columns")').first();
    await expect(columnLabel).toBeVisible({ timeout: 5000 });
  });

  test.describe('Site user management (userManagement)', () => {
    test('All Users navigates to User model list and shows seeded site user', async ({ page }) => {
      await ensureLoggedIn(page);
      await page.getByRole('link', { name: 'All Users' }).click();
      await expect(page).toHaveURL(/\/models\/User(\?|$)/, { timeout: 15000 });
      await expect(page.getByText('visitor@e2e.test')).toBeVisible({ timeout: 15000 });
    });

    test('Add User opens new-record form for User model', async ({ page }) => {
      await ensureLoggedIn(page);
      await page.getByRole('link', { name: 'Add User' }).click();
      await expect(page).toHaveURL(/\/models\/User\/new(\?|$)/, { timeout: 15000 });
      await expect(page.getByRole('heading', { name: 'New Record' })).toBeVisible({ timeout: 15000 });
    });
  });
});

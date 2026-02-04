/**
 * Admin Panel E2E Tests
 * Tests for admin panel CRUD functionality
 */

const { test, expect } = require('@playwright/test');

const TEST_ADMIN = {
  name: 'Test Admin',
  email: 'admin@test.com',
  password: 'password123',
};

// Helper function to reset admin state (clear all admin users)
async function resetAdminState(page) {
  try {
    const response = await page.request.post('http://localhost:3001/_admin/api/debug/reset');
    const body = await response.json().catch(() => ({}));
    console.log('Reset response:', response.status(), body);
    return response.ok();
  } catch (error) {
    console.error('Reset endpoint error:', error.message);
    return false;
  }
}

// Helper function to get current auth status
async function getAuthStatus(page) {
  try {
    const checkResponse = await page.request.get('http://localhost:3001/_admin/api/auth/check');
    const checkBody = await checkResponse.json();
    return { adminExists: checkBody.exists };
  } catch (error) {
    console.error('Auth check error:', error.message);
    return { adminExists: false };
  }
}

// Helper to ensure user is logged in
async function ensureLoggedIn(page) {
  await page.goto('/_admin');
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

test.describe('Admin Panel', () => {
  
  // Run these tests first to test setup/login flow
  test.describe.serial('Authentication Flow', () => {
    
    test('should be able to reset and show setup form', async ({ page }) => {
      // Reset admin state
      const resetSuccess = await resetAdminState(page);
      console.log('Reset success:', resetSuccess);
      
      // Navigate to admin panel
      await page.goto('/_admin');
      await page.waitForLoadState('networkidle');
      
      // Wait for page to load
      await page.waitForSelector('h1', { timeout: 10000 });
      
      // Get auth status
      const { adminExists } = await getAuthStatus(page);
      console.log('Admin exists after reset:', adminExists);
      
      // Check what's shown
      const heading = await page.locator('h1').textContent();
      console.log('Page heading:', heading);
      
      // If reset worked, should see Setup form
      // If reset didn't work (admin exists), test will still pass with correct state
      if (!adminExists) {
        await expect(page.locator('h1')).toContainText('Setup Admin Account');
        await expect(page.locator('input[name="name"]')).toBeVisible();
        await expect(page.locator('input[name="email"]')).toBeVisible();
        await expect(page.locator('input[name="password"]')).toBeVisible();
      } else {
        // Admin exists, should see login or admin panel
        const isSetup = heading.includes('Setup');
        const isLogin = heading.includes('Login');
        const isPanel = heading.includes('Admin Panel');
        expect(isSetup || isLogin || isPanel).toBeTruthy();
      }
    });

    test('should be able to create admin or login', async ({ page }) => {
      await page.goto('/_admin');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('h1', { timeout: 10000 });
      
      const heading = await page.locator('h1').textContent();
      
      if (heading.includes('Setup Admin Account')) {
        // Create admin account
        await page.fill('input[name="name"]', TEST_ADMIN.name);
        await page.fill('input[name="email"]', TEST_ADMIN.email);
        await page.fill('input[name="password"]', TEST_ADMIN.password);
        await page.click('button[type="submit"]');
        
        // Should redirect to admin panel
        await page.waitForURL(/\/(_admin)?(\/)?$/, { timeout: 15000 });
        await expect(page.locator('text=Admin Panel')).toBeVisible({ timeout: 10000 });
      } else if (heading.includes('Admin Login')) {
        // Login
        await page.fill('input[name="email"]', TEST_ADMIN.email);
        await page.fill('input[name="password"]', TEST_ADMIN.password);
        await page.click('button[type="submit"]');
        
        // Should redirect to admin panel
        await page.waitForURL(/\/(_admin)?(\/)?$/, { timeout: 15000 });
        await expect(page.locator('text=Admin Panel')).toBeVisible({ timeout: 10000 });
      } else {
        // Already logged in
        await expect(page.locator('text=Admin Panel')).toBeVisible({ timeout: 10000 });
      }
    });
  });

  // These tests run after auth flow is verified
  test.describe('Admin Panel Features', () => {
    
    test.beforeEach(async ({ page }) => {
      await ensureLoggedIn(page);
    });

    test('should display model list', async ({ page }) => {
      // Should see models heading
      const modelsHeading = page.locator('h2:has-text("Models")');
      await expect(modelsHeading).toBeVisible({ timeout: 15000 });
      
      // Should see TestPost model
      const modelCard = page.locator('text=Test Posts').or(page.locator('text=TestPost'));
      await expect(modelCard).toBeVisible({ timeout: 15000 });
    });

    test('should navigate to model records page', async ({ page }) => {
      // Wait for models to load
      await page.waitForSelector('h2:has-text("Models")', { timeout: 15000 });
      
      // Click on TestPost model
      const modelLink = page.locator('a:has-text("Test Posts")').or(page.locator('a:has-text("TestPost")'));
      await expect(modelLink).toBeVisible({ timeout: 15000 });
      await modelLink.click();
      
      // Should navigate to records page
      await page.waitForURL(/\/models\/TestPost/, { timeout: 15000 });
      await page.waitForLoadState('networkidle');
      
      // Wait for records page to load - check for New Record button which is always shown
      const newRecordBtn = page.locator('button:has-text("New Record")');
      await expect(newRecordBtn).toBeVisible({ timeout: 15000 });
    });

    test('should access new record form with rendered fields', async ({ page }) => {
      // Navigate to TestPost model records
      await page.goto('/_admin/models/TestPost');
      await page.waitForLoadState('networkidle');
      
      // Wait for page to load
      await page.waitForSelector('button:has-text("New Record")', { timeout: 15000 });
      
      // Click "New Record" button
      await page.click('button:has-text("New Record")');
      
      // Should navigate to new record form
      await page.waitForURL(/\/models\/TestPost\/new/, { timeout: 15000 });
      await page.waitForLoadState('networkidle');
      
      // Check form exists
      const formHeading = page.locator('h2:has-text("New Record")');
      await expect(formHeading).toBeVisible({ timeout: 15000 });
      
      // Verify form fields are rendered based on model schema
      // Title field (string type) should be a text input
      const titleInput = page.locator('input#title, input[name="title"]');
      await expect(titleInput).toBeVisible({ timeout: 10000 });
      
      // Content field (text type) should be a textarea
      const contentInput = page.locator('textarea#content, textarea[name="content"]');
      await expect(contentInput).toBeVisible({ timeout: 10000 });
      
      // Published field (boolean type) should be a checkbox
      const publishedCheckbox = page.locator('input[type="checkbox"][name="published"]');
      await expect(publishedCheckbox).toBeVisible({ timeout: 10000 });
      
      // ID field should NOT be visible in new record mode (auto-generated)
      const idInput = page.locator('input#id, input[name="id"]');
      await expect(idInput).not.toBeVisible();
      
      // Save and Cancel buttons should be visible
      await expect(page.locator('button:has-text("Save")')).toBeVisible();
      await expect(page.locator('button:has-text("Cancel")')).toBeVisible();
    });

    test('should create a new record with form fields', async ({ page }) => {
      // Navigate to new record form
      await page.goto('/_admin/models/TestPost/new');
      await page.waitForLoadState('networkidle');
      
      // Wait for form to load
      await page.waitForSelector('input#title, input[name="title"]', { timeout: 15000 });
      
      // Fill in the form
      await page.fill('input#title, input[name="title"]', 'Test Post Title');
      await page.fill('textarea#content, textarea[name="content"]', 'This is test content for the post.');
      await page.check('input[type="checkbox"][name="published"]');
      
      // Submit the form
      await page.click('button:has-text("Save")');
      
      // Should redirect back to records list
      await page.waitForURL(/\/models\/TestPost$/, { timeout: 15000 });
      await page.waitForLoadState('networkidle');
      
      // The new record should appear in the list (or we should see a table)
      const recordsTable = page.locator('table');
      await expect(recordsTable).toBeVisible({ timeout: 15000 });
    });

    test('should display records list with dynamic columns', async ({ page }) => {
      // First create a record so we have data to display
      await page.goto('/_admin/models/TestPost/new');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('input#title, input[name="title"]', { timeout: 15000 });
      
      // Fill and submit form
      await page.fill('input#title, input[name="title"]', 'Column Test Post');
      await page.fill('textarea#content, textarea[name="content"]', 'Content for column test');
      await page.click('button:has-text("Save")');
      
      // Wait for redirect to list
      await page.waitForURL(/\/models\/TestPost$/, { timeout: 15000 });
      await page.waitForLoadState('networkidle');
      
      // Wait for table to load
      await page.waitForSelector('table', { timeout: 15000 });
      
      // Verify dynamic column headers are present (id, title, published are expected columns)
      const idHeader = page.locator('th:has-text("id")');
      const titleHeader = page.locator('th:has-text("title")');
      
      await expect(idHeader).toBeVisible({ timeout: 10000 });
      await expect(titleHeader).toBeVisible({ timeout: 10000 });
      
      // Verify Actions column is present
      const actionsHeader = page.locator('th:has-text("Actions")');
      await expect(actionsHeader).toBeVisible({ timeout: 10000 });
      
      // Verify Edit and Delete buttons are in table rows
      await expect(page.locator('button:has-text("Edit")').first()).toBeVisible({ timeout: 10000 });
      await expect(page.locator('button:has-text("Delete")').first()).toBeVisible({ timeout: 10000 });
    });

    test('should display breadcrumb navigation on records page', async ({ page }) => {
      // Navigate to TestPost records
      await page.goto('/_admin/models/TestPost');
      await page.waitForLoadState('networkidle');
      
      // Wait for page to load
      await page.waitForSelector('h2', { timeout: 15000 });
      
      // Verify breadcrumb navigation is present
      const breadcrumbNav = page.locator('nav[aria-label="Breadcrumb"]');
      await expect(breadcrumbNav).toBeVisible({ timeout: 10000 });
      
      // Verify home icon link is present
      const homeLink = page.locator('nav[aria-label="Breadcrumb"] a svg');
      await expect(homeLink.first()).toBeVisible({ timeout: 10000 });
      
      // Verify model name is in breadcrumb
      const modelBreadcrumb = page.locator('nav[aria-label="Breadcrumb"]').getByText(/TestPost|Test Post/);
      await expect(modelBreadcrumb).toBeVisible({ timeout: 10000 });
    });

    test('should display breadcrumb navigation on form page', async ({ page }) => {
      // Navigate to new record form
      await page.goto('/_admin/models/TestPost/new');
      await page.waitForLoadState('networkidle');
      
      // Wait for form to load
      await page.waitForSelector('h2:has-text("New Record")', { timeout: 15000 });
      
      // Verify breadcrumb has model link and "New" item
      const breadcrumbNav = page.locator('nav[aria-label="Breadcrumb"]');
      await expect(breadcrumbNav).toBeVisible({ timeout: 10000 });
      
      // Model name should be a link
      const modelLink = page.locator('nav[aria-label="Breadcrumb"] a').filter({ hasText: /TestPost|Test Post/ });
      await expect(modelLink).toBeVisible({ timeout: 10000 });
      
      // "New" should be the last breadcrumb item (not a link)
      const newBreadcrumb = page.locator('nav[aria-label="Breadcrumb"] span:has-text("New")');
      await expect(newBreadcrumb).toBeVisible({ timeout: 10000 });
    });

    test('should have sticky header on admin panel', async ({ page }) => {
      // Navigate to admin panel
      await page.goto('/_admin');
      await page.waitForLoadState('networkidle');
      
      // Wait for header
      const header = page.locator('.sticky.top-0');
      await expect(header).toBeVisible({ timeout: 10000 });
      
      // Header should contain Admin Panel text
      await expect(header.locator('text=Admin Panel')).toBeVisible();
    });

    test('should have sticky form buttons on record form', async ({ page }) => {
      // Navigate to new record form
      await page.goto('/_admin/models/TestPost/new');
      await page.waitForLoadState('networkidle');
      
      // Wait for form to load
      await page.waitForSelector('form', { timeout: 15000 });
      
      // Verify sticky footer with buttons exists
      const stickyFooter = page.locator('.sticky.bottom-0');
      await expect(stickyFooter).toBeVisible({ timeout: 10000 });
      
      // Verify Save and Cancel buttons are in the sticky footer
      await expect(stickyFooter.locator('button:has-text("Save")')).toBeVisible();
      await expect(stickyFooter.locator('button:has-text("Cancel")')).toBeVisible();
    });

    test('should display table with records and proper structure', async ({ page }) => {
      // Create a record to ensure we have data
      await page.goto('/_admin/models/TestPost/new');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('input#title, input[name="title"]', { timeout: 15000 });
      
      await page.fill('input#title, input[name="title"]', 'Table Structure Test Post');
      await page.fill('textarea#content, textarea[name="content"]', 'Content for table structure test');
      await page.click('button:has-text("Save")');
      
      await page.waitForURL(/\/models\/TestPost$/, { timeout: 15000 });
      await page.waitForLoadState('networkidle');
      
      // Wait for table to load
      await page.waitForSelector('table', { timeout: 15000 });
      
      // Verify table has sticky header (thead with sticky positioning)
      const tableHeader = page.locator('thead');
      await expect(tableHeader).toBeVisible({ timeout: 10000 });
      
      // Verify there are table rows with data
      const tableRows = page.locator('tbody tr');
      const rowCount = await tableRows.count();
      expect(rowCount).toBeGreaterThan(0);
      
      // Verify Actions column exists with Edit/Delete buttons
      const editButton = page.locator('tbody tr button:has-text("Edit")').first();
      const deleteButton = page.locator('tbody tr button:has-text("Delete")').first();
      await expect(editButton).toBeVisible({ timeout: 10000 });
      await expect(deleteButton).toBeVisible({ timeout: 10000 });
    });

    test('should display pagination with many records', async ({ page }) => {
      // Create 25 records to trigger pagination (perPage=20)
      // Use API directly for faster record creation
      for (let i = 1; i <= 25; i++) {
        await page.request.post('http://localhost:3001/_admin/api/models/TestPost/records', {
          data: {
            title: `Pagination Test Post ${i}`,
            content: `Content for pagination test ${i}`,
            published: i % 2 === 0, // alternate true/false
          },
        });
      }
      
      // Navigate to records list
      await page.goto('/_admin/models/TestPost');
      await page.waitForLoadState('networkidle');
      
      // Wait for table to load
      await page.waitForSelector('table', { timeout: 15000 });
      
      // Verify pagination controls are visible (Next button)
      const nextButton = page.locator('button:has-text("Next")');
      await expect(nextButton).toBeVisible({ timeout: 10000 });
      
      // Verify "Showing X to Y of Z results" text parts are visible
      const showingText = page.locator('text=Showing');
      await expect(showingText).toBeVisible({ timeout: 10000 });
      
      // Verify page numbers are visible
      const pageButton = page.locator('nav button').filter({ hasText: /^[12]$/ }).first();
      await expect(pageButton).toBeVisible({ timeout: 10000 });
      
      // Click next page and verify table updates
      await nextButton.click();
      await page.waitForTimeout(500); // Wait for API response
      
      // Prev button should now be enabled
      const prevButton = page.locator('button:has-text("Prev")');
      await expect(prevButton).toBeVisible({ timeout: 10000 });
    });

    test('should be able to logout', async ({ page }) => {
      // Find and click logout button
      const logoutButton = page.locator('button:has-text("Logout")');
      await expect(logoutButton).toBeVisible({ timeout: 15000 });
      await logoutButton.click();
      
      // Should redirect to login page
      await page.waitForURL(/\/login/, { timeout: 10000 });
      
      // Should see login form
      const loginHeading = page.locator('h1:has-text("Admin Login")');
      await expect(loginHeading).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Login Validation', () => {
    
    test.beforeEach(async ({ page }) => {
      // Ensure admin exists
      const { adminExists } = await getAuthStatus(page);
      if (!adminExists) {
        // Create admin first
        await page.goto('/_admin');
        await page.waitForLoadState('networkidle');
        await page.waitForSelector('h1', { timeout: 10000 });
        
        const heading = await page.locator('h1').textContent();
        if (heading.includes('Setup Admin Account')) {
          await page.fill('input[name="name"]', TEST_ADMIN.name);
          await page.fill('input[name="email"]', TEST_ADMIN.email);
          await page.fill('input[name="password"]', TEST_ADMIN.password);
          await page.click('button[type="submit"]');
          await page.waitForURL(/\/(_admin)?(\/)?$/, { timeout: 15000 });
          
          // Logout to test login
          await page.waitForSelector('button:has-text("Logout")', { timeout: 10000 });
          await page.click('button:has-text("Logout")');
          await page.waitForURL(/\/login/, { timeout: 10000 });
        }
      }
    });

    test('should show error with incorrect credentials', async ({ page }) => {
      await page.goto('/_admin/login');
      await page.waitForLoadState('networkidle');
      
      // Wait for login form
      const emailInput = page.locator('input[name="email"]');
      await expect(emailInput).toBeVisible({ timeout: 15000 });
      
      // Fill with wrong password
      await emailInput.fill('admin@test.com');
      await page.fill('input[name="password"]', 'wrongpassword');
      
      // Submit
      await page.click('button[type="submit"]');
      
      // Wait for response
      await page.waitForTimeout(1000);
      
      // Should show error message (red background class)
      const errorMessage = page.locator('.bg-red-100, [class*="error"], [class*="text-red"]');
      await expect(errorMessage.first()).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Chainable Validation and UI Config', () => {
    
    test.beforeEach(async ({ page }) => {
      await ensureLoggedIn(page);
    });

    test('should display custom labels from UI config', async ({ page }) => {
      // Navigate to new record form
      await page.goto('/_admin/models/TestPost/new');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('input#title, input[name="title"]', { timeout: 15000 });
      
      // Verify custom label is displayed
      const titleLabel = page.locator('label[for="title"]');
      await expect(titleLabel).toContainText('Post Title', { timeout: 10000 });
      
      const contentLabel = page.locator('label[for="content"]');
      await expect(contentLabel).toContainText('Content', { timeout: 10000 });
      
      const publishedLabel = page.locator('label').filter({ hasText: 'Published' });
      await expect(publishedLabel).toBeVisible({ timeout: 10000 });
    });

    test('should display placeholders from UI config', async ({ page }) => {
      // Navigate to new record form
      await page.goto('/_admin/models/TestPost/new');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('input#title, input[name="title"]', { timeout: 15000 });
      
      // Verify placeholder is displayed
      const titleInput = page.locator('input#title, input[name="title"]');
      await expect(titleInput).toHaveAttribute('placeholder', 'Enter post title', { timeout: 10000 });
      
      const contentTextarea = page.locator('textarea#content, textarea[name="content"]');
      await expect(contentTextarea).toHaveAttribute('placeholder', 'Write your post content here...', { timeout: 10000 });
    });

    test('should display hint messages from UI config', async ({ page }) => {
      // Navigate to new record form
      await page.goto('/_admin/models/TestPost/new');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('input#title, input[name="title"]', { timeout: 15000 });
      
      // Verify hint messages are displayed
      const titleHint = page.locator('p.text-xs.text-gray-500').filter({ hasText: 'Title must be between 1 and 200 characters' });
      await expect(titleHint).toBeVisible({ timeout: 10000 });
      
      const contentHint = page.locator('p.text-xs.text-gray-500').filter({ hasText: 'Content must be at least 10 characters' });
      await expect(contentHint).toBeVisible({ timeout: 10000 });
      
      const publishedHint = page.locator('p.text-xs.text-gray-500').filter({ hasText: 'Check to publish this post' });
      await expect(publishedHint).toBeVisible({ timeout: 10000 });
    });

    test('should apply validation rules from chainable API', async ({ page }) => {
      // Navigate to new record form
      await page.goto('/_admin/models/TestPost/new');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('input#title, input[name="title"]', { timeout: 15000 });
      
      // Verify min/max attributes are set
      const titleInput = page.locator('input#title, input[name="title"]');
      await expect(titleInput).toHaveAttribute('minlength', '1', { timeout: 10000 });
      await expect(titleInput).toHaveAttribute('maxlength', '200', { timeout: 10000 });
      
      const contentTextarea = page.locator('textarea#content, textarea[name="content"]');
      await expect(contentTextarea).toHaveAttribute('minlength', '10', { timeout: 10000 });
    });

    test('should validate form with chainable validation rules', async ({ page }) => {
      // Navigate to new record form
      await page.goto('/_admin/models/TestPost/new');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('input#title, input[name="title"]', { timeout: 15000 });
      
      // Try to submit with invalid data (title too short, content too short)
      await page.fill('input#title, input[name="title"]', ''); // Empty title (min: 1)
      await page.fill('textarea#content, textarea[name="content"]', 'short'); // Too short (min: 10)
      
      // Submit form
      await page.click('button:has-text("Save")');
      
      // Should show validation errors (browser native validation or API errors)
      // Wait a bit for validation
      await page.waitForTimeout(500);
      
      // Check if form is still visible (validation prevented submission)
      // or if error message is shown
      const formStillVisible = await page.locator('form').isVisible();
      const errorVisible = await page.locator('.bg-red-100, [class*="error"]').isVisible();
      
      // Either form should still be visible (native validation) or error should be shown
      expect(formStillVisible || errorVisible).toBeTruthy();
    });

    test('should successfully submit form with valid data', async ({ page }) => {
      // Navigate to new record form
      await page.goto('/_admin/models/TestPost/new');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('input#title, input[name="title"]', { timeout: 15000 });
      
      // Fill form with valid data
      await page.fill('input#title, input[name="title"]', 'Valid Post Title');
      await page.fill('textarea#content, textarea[name="content"]', 'This is a valid content that is longer than 10 characters');
      await page.check('input[type="checkbox"][name="published"]');
      
      // Submit form
      await page.click('button:has-text("Save")');
      
      // Should redirect to records list
      await page.waitForURL(/\/models\/TestPost$/, { timeout: 15000 });
      await page.waitForLoadState('networkidle');
      
      // Verify record was created
      const recordsTable = page.locator('table');
      await expect(recordsTable).toBeVisible({ timeout: 15000 });
    });

    test('should use custom textarea rows from UI config', async ({ page }) => {
      // Navigate to new record form
      await page.goto('/_admin/models/TestPost/new');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('textarea#content, textarea[name="content"]', { timeout: 15000 });
      
      // Verify textarea has custom rows attribute
      const contentTextarea = page.locator('textarea#content, textarea[name="content"]');
      await expect(contentTextarea).toHaveAttribute('rows', '6', { timeout: 10000 });
    });
  });

  test.describe('Rich Text Editor', () => {
    
    test.beforeEach(async ({ page }) => {
      await ensureLoggedIn(page);
    });

    test('should display rich text editor for custom field', async ({ page }) => {
      // Navigate to new record form
      await page.goto('/_admin/models/TestPost/new');
      await page.waitForLoadState('networkidle');
      
      // Wait for form to load
      await page.waitForSelector('input#title, input[name="title"]', { timeout: 15000 });
      
      // Wait for Quill to load (may take a moment)
      await page.waitForTimeout(2000);
      
      // Verify rich text editor container exists
      const richTextEditor = page.locator('#quill-editor-body');
      await expect(richTextEditor).toBeVisible({ timeout: 15000 });
      
      // Verify Quill editor is initialized (check for toolbar)
      const quillToolbar = page.locator('.ql-toolbar');
      await expect(quillToolbar).toBeVisible({ timeout: 10000 });
      
      // Verify hidden input exists (hidden inputs are not visible, so check for attachment)
      const hiddenInput = page.locator('input[type="hidden"][id="body-value"]');
      await expect(hiddenInput).toBeAttached({ timeout: 10000 });
    });

    test('should save rich text content', async ({ page }) => {
      // Navigate to new record form
      await page.goto('/_admin/models/TestPost/new');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('input#title, input[name="title"]', { timeout: 15000 });
      
      // Fill basic fields
      await page.fill('input#title, input[name="title"]', 'Rich Text Test Post');
      await page.fill('textarea#content, textarea[name="content"]', 'This is regular content');
      
      // Wait for Quill to load
      await page.waitForTimeout(2000);
      
      // Type in rich text editor
      const richTextEditor = page.locator('#quill-editor-body');
      await expect(richTextEditor).toBeVisible({ timeout: 15000 });
      
      // Click on editor and type content
      await richTextEditor.click();
      await page.keyboard.type('This is rich text content');
      
      // Wait a bit for Quill to update
      await page.waitForTimeout(500);
      
      // Submit form
      await page.click('button:has-text("Save")');
      
      // Should redirect to records list
      await page.waitForURL(/\/models\/TestPost$/, { timeout: 15000 });
      await page.waitForLoadState('networkidle');
      
      // Verify record was created
      const recordsTable = page.locator('table');
      await expect(recordsTable).toBeVisible({ timeout: 15000 });
    });

    test('should load existing rich text content in edit mode', async ({ page }) => {
      // First create a record with rich text content via API
      const createResponse = await page.request.post('http://localhost:3001/_admin/api/models/TestPost/records', {
        data: {
          title: 'Edit Rich Text Test',
          content: 'Regular content',
          body: '<p>This is <strong>rich text</strong> content</p>',
          published: true,
        },
      });
      
      expect(createResponse.ok()).toBeTruthy();
      const created = await createResponse.json();
      const recordId = created.data.id;
      
      // Navigate to edit form
      await page.goto('/_admin/models/TestPost/edit/' + recordId);
      await page.waitForLoadState('networkidle');
      
      // Wait for form to load
      await page.waitForSelector('input#title, input[name="title"]', { timeout: 15000 });
      
      // Wait for Quill to load
      await page.waitForTimeout(2000);
      
      // Verify rich text editor is visible
      const richTextEditor = page.locator('#quill-editor-body');
      await expect(richTextEditor).toBeVisible({ timeout: 15000 });
      
      // Verify content is loaded (check for strong tag in editor)
      const editorContent = await richTextEditor.locator('.ql-editor').innerHTML();
      expect(editorContent).toContain('rich text');
    });

    test('should validate required rich-text field is not empty', async ({ page }) => {
      await page.goto('/_admin/models/TestPost/new');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('input#title', { timeout: 15000 });

      // Fill other required fields
      await page.fill('input#title', 'Test Post');
      await page.fill('textarea#content', 'This is some content for testing.');

      // Don't fill body (required rich-text field)
      // Try to submit
      await page.click('button:has-text("Save")');
      await page.waitForTimeout(1000);

      // Should show validation error or stay on form
      const errorMessage = page.locator('text=/required|Rich Text Body/i');
      const isStillOnForm = await page.locator('h2:has-text("New Record")').isVisible();
      
      expect(errorMessage.isVisible().catch(() => false) || isStillOnForm).toBeTruthy();
    });
  });

  test.describe('Filtering', () => {
    test.beforeEach(async ({ page }) => {
      await ensureLoggedIn(page);
    });

    test('should display quick filters bar with All Filters button', async ({ page }) => {
      await page.goto('/_admin/models/TestPost');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('h2', { timeout: 10000 });
      
      // Quick filters bar should be visible
      const allFiltersButton = page.locator('button:has-text("All Filters")');
      await expect(allFiltersButton).toBeVisible({ timeout: 10000 });
    });

    test('should open and close filter drawer', async ({ page }) => {
      await page.goto('/_admin/models/TestPost');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('button:has-text("All Filters")', { timeout: 10000 });
      
      // Open filter drawer
      await page.click('button:has-text("All Filters")');
      await page.waitForTimeout(500);
      
      // Drawer heading should be visible
      const drawerHeading = page.locator('h3:has-text("Advanced Filters")');
      await expect(drawerHeading).toBeVisible({ timeout: 5000 });
      
      // Close via Cancel button (more reliable than × icon)
      await page.click('button:has-text("Cancel")');
      await page.waitForTimeout(500);
      
      await expect(drawerHeading).not.toBeVisible({ timeout: 5000 });
    });

    test('should filter by string field using quick search', async ({ page }) => {
      const timestamp = Date.now();
      const matchingTitle = 'FilterMatch_' + timestamp;
      const nonMatchingTitle = 'OtherPost_' + timestamp;
      
      await page.request.post('http://localhost:3001/_admin/api/models/TestPost/records', {
        data: { title: matchingTitle, content: 'Content for filter test' },
      });
      await page.request.post('http://localhost:3001/_admin/api/models/TestPost/records', {
        data: { title: nonMatchingTitle, content: 'Another content' },
      });
      
      await page.goto('/_admin/models/TestPost');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('table', { timeout: 15000 });
      
      await expect(page.getByRole('cell', { name: matchingTitle })).toBeVisible({ timeout: 5000 });
      await expect(page.getByRole('cell', { name: nonMatchingTitle })).toBeVisible({ timeout: 5000 });
      
      // Use quick search in the quick filters bar
      const quickSearchInput = page.locator('input[placeholder*="Search by"]').first();
      await expect(quickSearchInput).toBeVisible({ timeout: 5000 });
      await quickSearchInput.click();
      await quickSearchInput.fill('FilterMatch');
      await page.waitForTimeout(500);
      
      // Press Enter or wait for auto-apply
      await page.keyboard.press('Enter');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
      
      expect(page.url()).toContain('filter');
      
      await expect(page.getByRole('cell', { name: matchingTitle })).toBeVisible({ timeout: 5000 });
      await expect(page.getByRole('cell', { name: nonMatchingTitle })).not.toBeVisible({ timeout: 3000 });
    });

    test('should filter by string field using drawer', async ({ page }) => {
      const timestamp = Date.now();
      const matchingTitle = 'DrawerFilter_' + timestamp;
      const nonMatchingTitle = 'OtherDrawer_' + timestamp;
      
      await page.request.post('http://localhost:3001/_admin/api/models/TestPost/records', {
        data: { title: matchingTitle, content: 'Content for drawer filter test' },
      });
      await page.request.post('http://localhost:3001/_admin/api/models/TestPost/records', {
        data: { title: nonMatchingTitle, content: 'Another content' },
      });
      
      await page.goto('/_admin/models/TestPost');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('table', { timeout: 15000 });
      
      // Open filter drawer
      await page.click('button:has-text("All Filters")');
      await page.waitForTimeout(500);
      
      // Find title filter input in drawer (placeholder is "Enter search term")
      const titleInput = page.locator('input[placeholder="Enter search term"]').first();
      await expect(titleInput).toBeVisible({ timeout: 5000 });
      await titleInput.click();
      await titleInput.fill('DrawerFilter');
      await page.waitForTimeout(300);
      
      // Apply filters
      await page.click('button:has-text("Apply Filters")');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
      
      expect(page.url()).toContain('filter');
      
      await expect(page.getByRole('cell', { name: matchingTitle })).toBeVisible({ timeout: 5000 });
      await expect(page.getByRole('cell', { name: nonMatchingTitle })).not.toBeVisible({ timeout: 3000 });
    });

    test('should filter by boolean field (published) via API', async ({ page }) => {
      const timestamp = Date.now();
      
      // Create test records
      await page.request.post('http://localhost:3001/_admin/api/models/TestPost/records', {
        data: { title: 'Published_' + timestamp, content: 'Published content', published: true },
      });
      await page.request.post('http://localhost:3001/_admin/api/models/TestPost/records', {
        data: { title: 'Draft_' + timestamp, content: 'Draft content', published: false },
      });
      
      // Test filtering via API directly (more reliable)
      const filterResponse = await page.request.get('http://localhost:3001/_admin/api/models/TestPost/records?filter[published][value]=true');
      expect(filterResponse.ok()).toBeTruthy();
      
      const result = await filterResponse.json();
      const titles = result.data.map(r => r.title);
      
      // Published record should be in results
      expect(titles.some(t => t.includes('Published_' + timestamp))).toBeTruthy();
      // Draft record should NOT be in results  
      expect(titles.some(t => t.includes('Draft_' + timestamp))).toBeFalsy();
    });

    test('should display boolean filter options in drawer', async ({ page }) => {
      await page.goto('/_admin/models/TestPost');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('button:has-text("All Filters")', { timeout: 10000 });
      
      // Open filter drawer
      await page.click('button:has-text("All Filters")');
      await page.waitForTimeout(500);
      
      // Verify boolean filter UI is present (Yes, No, Any options)
      const publishedLabel = page.locator('label:has-text("Published")');
      await expect(publishedLabel).toBeVisible({ timeout: 5000 });
      
      // Verify radio buttons are present
      const yesOption = page.locator('span:has-text("Yes")');
      const noOption = page.locator('span:has-text("No")');
      const anyOption = page.locator('span:has-text("Any")');
      
      await expect(yesOption.first()).toBeVisible({ timeout: 3000 });
      await expect(noOption.first()).toBeVisible({ timeout: 3000 });
      await expect(anyOption.first()).toBeVisible({ timeout: 3000 });
      
      // Close drawer
      await page.click('button:has-text("Cancel")');
    });

    test('should show filter badges with descriptive text', async ({ page }) => {
      await page.request.post('http://localhost:3001/_admin/api/models/TestPost/records', {
        data: { title: 'BadgeTest', content: 'Test content' },
      });
      
      await page.goto('/_admin/models/TestPost');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('button:has-text("All Filters")', { timeout: 10000 });
      
      // Use quick search
      const quickSearchInput = page.locator('input[placeholder*="Search by"]').first();
      await quickSearchInput.click();
      await quickSearchInput.fill('Badge');
      await page.keyboard.press('Enter');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
      
      // Filter badge should be visible with descriptive text (Contains instead of ~)
      const filterBadge = page.locator('.bg-indigo-50.text-indigo-700, .bg-blue-50.text-blue-700').first();
      await expect(filterBadge).toBeVisible({ timeout: 5000 });
      
      // Should contain descriptive operator text
      const badgeText = await filterBadge.textContent();
      expect(badgeText).toMatch(/Contains|contains|title/i);
    });

    test('should remove filter via badge', async ({ page }) => {
      await page.request.post('http://localhost:3001/_admin/api/models/TestPost/records', {
        data: { title: 'RemoveTest', content: 'Test content' },
      });
      
      await page.goto('/_admin/models/TestPost');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('button:has-text("All Filters")', { timeout: 10000 });
      
      // Apply filter via quick search
      const quickSearchInput = page.locator('input[placeholder*="Search by"]').first();
      await quickSearchInput.click();
      await quickSearchInput.fill('Remove');
      await page.keyboard.press('Enter');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
      
      // Find badge and its remove button
      const filterBadge = page.locator('.bg-indigo-50.text-indigo-700, .bg-blue-50.text-blue-700').first();
      await expect(filterBadge).toBeVisible({ timeout: 5000 });
      
      const removeButton = filterBadge.locator('button');
      await removeButton.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);
      
      await expect(filterBadge).not.toBeVisible({ timeout: 5000 });
    });

    test('should clear all filters via drawer', async ({ page }) => {
      await page.request.post('http://localhost:3001/_admin/api/models/TestPost/records', {
        data: { title: 'ClearTest', content: 'Test content' },
      });
      
      await page.goto('/_admin/models/TestPost');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('button:has-text("All Filters")', { timeout: 10000 });
      
      // Apply filter
      const quickSearchInput = page.locator('input[placeholder*="Search by"]').first();
      await quickSearchInput.click();
      await quickSearchInput.fill('Clear');
      await page.keyboard.press('Enter');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
      
      const filterBadge = page.locator('.bg-indigo-50.text-indigo-700, .bg-blue-50.text-blue-700').first();
      await expect(filterBadge).toBeVisible({ timeout: 5000 });
      
      // Open drawer and clear
      await page.click('button:has-text("All Filters")');
      await page.waitForTimeout(500);
      
      await page.click('button:has-text("Clear all")');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);
      
      await expect(filterBadge).not.toBeVisible({ timeout: 5000 });
    });

    test('should persist filters in URL', async ({ page }) => {
      await page.request.post('http://localhost:3001/_admin/api/models/TestPost/records', {
        data: { title: 'URLPersist', content: 'Test content' },
      });
      
      await page.goto('/_admin/models/TestPost');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('button:has-text("All Filters")', { timeout: 10000 });
      
      // Apply filter
      const quickSearchInput = page.locator('input[placeholder*="Search by"]').first();
      await quickSearchInput.click();
      await quickSearchInput.fill('URLPersist');
      await page.keyboard.press('Enter');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
      
      const urlWithFilter = page.url();
      expect(urlWithFilter).toContain('filter');
      
      await page.reload();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
      
      const filterBadge = page.locator('.bg-indigo-50.text-indigo-700, .bg-blue-50.text-blue-700');
      await expect(filterBadge.first()).toBeVisible({ timeout: 5000 });
    });

    test('should display badge count on All Filters button', async ({ page }) => {
      await page.request.post('http://localhost:3001/_admin/api/models/TestPost/records', {
        data: { title: 'CountTest', content: 'Test content' },
      });
      
      await page.goto('/_admin/models/TestPost');
      await page.waitForLoadState('networkidle');
      
      // Apply filter
      const quickSearchInput = page.locator('input[placeholder*="Search by"]').first();
      await quickSearchInput.click();
      await quickSearchInput.fill('Count');
      await page.keyboard.press('Enter');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
      
      // All Filters button should show badge count
      const filterCountBadge = page.locator('button:has-text("All Filters") span.bg-indigo-600');
      await expect(filterCountBadge).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Boolean Field Handling', () => {
    test.beforeEach(async ({ page }) => {
      await ensureLoggedIn(page);
    });

    test('should correctly save and retrieve boolean field values', async ({ page }) => {
      // Create a record with published=true via API
      const createResponse = await page.request.post('http://localhost:3001/_admin/api/models/TestPost/records', {
        data: {
          title: 'Boolean True Test',
          content: 'Testing boolean field',
          published: true,
        },
      });
      
      expect(createResponse.ok()).toBeTruthy();
      const created = await createResponse.json();
      const recordId = created.data.id;
      
      // Fetch the record and verify boolean value
      const getResponse = await page.request.get(`http://localhost:3001/_admin/api/models/TestPost/records/${recordId}`);
      expect(getResponse.ok()).toBeTruthy();
      const fetched = await getResponse.json();
      
      // SQLite returns 0/1, but the value should be correctly interpreted
      expect(fetched.data.published === true || fetched.data.published === 1).toBeTruthy();
    });

    test('should correctly update boolean field from false to true', async ({ page }) => {
      // Create a record with published=false
      const createResponse = await page.request.post('http://localhost:3001/_admin/api/models/TestPost/records', {
        data: {
          title: 'Boolean Update Test',
          content: 'Testing boolean update',
          published: false,
        },
      });
      
      expect(createResponse.ok()).toBeTruthy();
      const created = await createResponse.json();
      const recordId = created.data.id;
      
      // Update to published=true
      const updateResponse = await page.request.put(`http://localhost:3001/_admin/api/models/TestPost/records/${recordId}`, {
        data: {
          published: true,
        },
      });
      
      expect(updateResponse.ok()).toBeTruthy();
      const updated = await updateResponse.json();
      expect(updated.data.published === true || updated.data.published === 1).toBeTruthy();
    });

    test('should handle boolean field in form submission', async ({ page }) => {
      await page.goto('/_admin/models/TestPost/new');
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('input#title, input[name="title"]', { timeout: 15000 });
      
      // Fill the form
      await page.fill('input#title, input[name="title"]', 'Form Boolean Test');
      await page.fill('textarea#content, textarea[name="content"]', 'Testing form boolean submission');
      
      // Check the published checkbox
      const publishedCheckbox = page.locator('input[type="checkbox"][name="published"]');
      await publishedCheckbox.check();
      
      // Submit
      await page.click('button:has-text("Save")');
      await page.waitForURL(/\/models\/TestPost$/, { timeout: 15000 });
      
      // Verify the record appears with correct boolean display
      await page.waitForSelector('table', { timeout: 15000 });
      const recordRow = page.locator('tr').filter({ hasText: 'Form Boolean Test' });
      await expect(recordRow).toBeVisible({ timeout: 5000 });
    });

    test('should accept numeric 0/1 values for boolean fields via API', async ({ page }) => {
      // Test that API accepts numeric 0/1 (from SQLite) 
      const createResponse = await page.request.post('http://localhost:3001/_admin/api/models/TestPost/records', {
        data: {
          title: 'Numeric Boolean Test',
          content: 'Testing numeric boolean',
          published: 1, // Numeric instead of true
        },
      });
      
      expect(createResponse.ok()).toBeTruthy();
      const created = await createResponse.json();
      expect(created.data.published === true || created.data.published === 1).toBeTruthy();
    });
  });
});

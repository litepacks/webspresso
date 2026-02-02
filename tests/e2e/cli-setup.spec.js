/**
 * CLI Setup E2E Tests
 * Tests that verify project creation via CLI
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_PROJECT_DIR = path.join(os.tmpdir(), 'webspresso-e2e-test');
const PROJECT_NAME = 'test-app';
const PROJECT_PATH = path.join(TEST_PROJECT_DIR, PROJECT_NAME);

test.describe('CLI Setup', () => {
  test('should create project files', () => {
    // Verify project directory exists
    expect(fs.existsSync(PROJECT_PATH)).toBe(true);
  });

  test('should create package.json with correct content', () => {
    const packageJsonPath = path.join(PROJECT_PATH, 'package.json');
    expect(fs.existsSync(packageJsonPath)).toBe(true);
    
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    expect(packageJson.name).toBe(PROJECT_NAME);
    expect(packageJson.dependencies).toHaveProperty('webspresso');
    expect(packageJson.scripts).toHaveProperty('dev');
    expect(packageJson.scripts).toHaveProperty('start');
  });

  test('should create server.js', () => {
    const serverPath = path.join(PROJECT_PATH, 'server.js');
    expect(fs.existsSync(serverPath)).toBe(true);
    
    const serverContent = fs.readFileSync(serverPath, 'utf-8');
    expect(serverContent).toContain('createApp');
    expect(serverContent).toContain('adminPanelPlugin');
  });

  test('should create pages directory with index.njk', () => {
    const pagesDir = path.join(PROJECT_PATH, 'pages');
    const indexPage = path.join(pagesDir, 'index.njk');
    
    expect(fs.existsSync(pagesDir)).toBe(true);
    expect(fs.existsSync(indexPage)).toBe(true);
  });

  test('should create models directory with test model', () => {
    const modelsDir = path.join(PROJECT_PATH, 'models');
    const testModel = path.join(modelsDir, 'TestPost.js');
    
    expect(fs.existsSync(modelsDir)).toBe(true);
    expect(fs.existsSync(testModel)).toBe(true);
    
    const modelContent = fs.readFileSync(testModel, 'utf-8');
    expect(modelContent).toContain('defineModel');
    expect(modelContent).toContain('admin');
    expect(modelContent).toContain('enabled: true');
  });

  test('should create webspresso.db.js config', () => {
    const dbConfigPath = path.join(PROJECT_PATH, 'webspresso.db.js');
    expect(fs.existsSync(dbConfigPath)).toBe(true);
    
    const dbConfig = fs.readFileSync(dbConfigPath, 'utf-8');
    expect(dbConfig).toContain('better-sqlite3');
    expect(dbConfig).toContain('models');
  });

  test('should render homepage', async ({ page }) => {
    await page.goto('/');
    
    // Check for welcome message
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('Welcome');
  });
});

/**
 * Global Setup for E2E Tests
 * Creates test project before all tests run
 * Note: Server is started by webServer config in playwright.config.js
 */

const { createTestProject } = require('./fixtures/test-project');
const path = require('path');
const fs = require('fs');

async function globalSetup(config) {
  console.log('Setting up E2E test environment...');
  
  try {
    // Create test project (server will be started by webServer config)
    const projectPath = await createTestProject();
    
    // Store project path for teardown
    const setupData = {
      projectPath,
    };
    
    const setupDataPath = path.join(__dirname, '.e2e-setup.json');
    fs.writeFileSync(setupDataPath, JSON.stringify(setupData, null, 2));
    
    console.log('E2E test environment ready');
  } catch (error) {
    console.error('Failed to setup E2E test environment:', error);
    throw error;
  }
}

module.exports = globalSetup;

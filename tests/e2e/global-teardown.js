/**
 * Global Teardown for E2E Tests
 * Cleans up test project after all tests run
 */

const { cleanupTestProject } = require('./fixtures/test-project');
const path = require('path');
const fs = require('fs');

async function globalTeardown(config) {
  console.log('Cleaning up E2E test environment...');
  
  try {
    // Clean up test project
    cleanupTestProject();
    
    // Remove setup data file
    const setupDataPath = path.join(__dirname, '.e2e-setup.json');
    if (fs.existsSync(setupDataPath)) {
      fs.unlinkSync(setupDataPath);
    }
    
    console.log('E2E test environment cleaned up');
  } catch (error) {
    console.error('Failed to cleanup E2E test environment:', error);
    // Don't throw - cleanup failures shouldn't fail tests
  }
}

module.exports = globalTeardown;

/**
 * Test Server
 * Starts the test project server for E2E tests
 * This is called by Playwright's webServer config
 */

const { createTestProject, startTestServer } = require('./test-project');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_PROJECT_DIR = path.join(os.tmpdir(), 'webspresso-e2e-test');
const PROJECT_NAME = 'test-app';
const PROJECT_PATH = path.join(TEST_PROJECT_DIR, PROJECT_NAME);

(async () => {
  try {
    let projectPath = PROJECT_PATH;
    
    // Check if project already exists (from global-setup)
    if (!fs.existsSync(projectPath) || !fs.existsSync(path.join(projectPath, 'server.js'))) {
      // Create test project if it doesn't exist
      projectPath = await createTestProject();
    }
    
    // Start server
    const server = await startTestServer(projectPath);
    
    // Keep process alive
    process.on('SIGINT', () => {
      server.kill();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      server.kill();
      process.exit(0);
    });
    
    // Handle server exit
    server.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`Server exited with code ${code}`);
      }
      process.exit(code || 0);
    });
  } catch (error) {
    console.error('Failed to start test server:', error);
    process.exit(1);
  }
})();

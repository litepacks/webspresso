/**
 * Test Setup File
 * Global mocks, test utilities, and helpers
 */

const path = require('path');

// Set up environment variables for testing with per-worker isolated ports
const workerId = Number(process.env.VITEST_POOL_ID || process.env.VITEST_WORKER_ID || 0);
const testPort = String(3001 + workerId * 100);

process.env.NODE_ENV = 'test';
process.env.__WEBSPRESSO_TESTING__ = 'true';
process.env.PORT = testPort;
process.env.DEFAULT_LOCALE = 'en';
process.env.SUPPORTED_LOCALES = 'en,de';
process.env.BASE_URL = `http://localhost:${testPort}`;

const origCwd = process.cwd();

if (typeof afterEach === 'function') {
  afterEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = testPort;
    process.env.BASE_URL = `http://localhost:${testPort}`;
    if (process.cwd() !== origCwd) {
      try {
        process.chdir(origCwd);
      } catch (_) {}
    }
    try {
      const { clearCascadingCaches } = require('../src/routing/cascading');
      clearCascadingCaches();
    } catch (_) {}
  });
}

// Paths for test fixtures
const FIXTURES_PATH = path.join(__dirname, 'fixtures');
const FIXTURES_PAGES_PATH = path.join(FIXTURES_PATH, 'pages');

const {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockReq,
  createMockRes,
  createMockSpyRes,
  createMockRepo,
  createMockDb,
  createMockQueryBuilder,
  createTempDir,
  createTempSandbox,
  withTempDir,
  wait,
  sleep,
  deferredPromise,
  createDeferred,
  waitForCondition,
  waitFor,
  withTimeout,
  startTestServer,
  closeServer,
  fetchJson,
  fetchText,
  withTestServer,
  createMockServiceContext,
  createMockServiceRegistry,
  defineMockService,
} = require('./utils');

/**
 * Create a test context object
 * @param {Object} options - Context options
 * @returns {Object} Test context
 */
function createTestContext(options = {}) {
  const req = createMockRequest(options.req || {});
  const res = createMockResponse();
  
  return {
    req,
    res,
    path: options.path || '/',
    file: options.file || 'index.njk',
    routeDir: options.routeDir || FIXTURES_PAGES_PATH,
    locale: options.locale || 'en',
    t: options.t || ((key) => key),
    data: options.data || {},
    meta: options.meta || {
      title: 'Test Page',
      description: 'Test description',
      indexable: true,
      canonical: null
    },
    fsy: options.fsy || {},
    ...options
  };
}

/**
 * Create a temporary test file
 * @param {string} filePath - Relative path in fixtures
 * @param {string} content - File content
 */
function createTempFile(filePath, content) {
  const fs = require('fs');
  const fullPath = path.join(FIXTURES_PATH, filePath);
  const dir = path.dirname(fullPath);
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(fullPath, content);
  return fullPath;
}

/**
 * Remove a temporary test file
 * @param {string} filePath - Relative path in fixtures
 */
function removeTempFile(filePath) {
  const fs = require('fs');
  const fullPath = path.join(FIXTURES_PATH, filePath);
  
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}

/**
 * Clean up all temp files in a directory
 * @param {string} dirPath - Directory path
 */
function cleanupTempDir(dirPath) {
  const fs = require('fs');
  const fullPath = path.join(FIXTURES_PATH, dirPath);
  
  if (fs.existsSync(fullPath)) {
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
}

// Export utilities
module.exports = {
  FIXTURES_PATH,
  FIXTURES_PAGES_PATH,
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockReq,
  createMockRes,
  createMockSpyRes,
  createMockRepo,
  createMockDb,
  createMockQueryBuilder,
  createTestContext,
  createTempFile,
  removeTempFile,
  cleanupTempDir,
  createTempDir,
  createTempSandbox,
  withTempDir,
  wait,
  sleep,
  deferredPromise,
  createDeferred,
  waitForCondition,
  waitFor,
  withTimeout,
  startTestServer,
  closeServer,
  fetchJson,
  fetchText,
  withTestServer,
  createMockServiceContext,
  createMockServiceRegistry,
  defineMockService,
};

// Make utilities available globally in tests
global.testUtils = module.exports;




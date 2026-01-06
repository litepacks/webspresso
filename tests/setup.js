/**
 * Test Setup File
 * Global mocks, test utilities, and helpers
 */

const path = require('path');

// Set up environment variables for testing
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.DEFAULT_LOCALE = 'en';
process.env.SUPPORTED_LOCALES = 'en,tr';
process.env.BASE_URL = 'http://localhost:3001';

// Paths for test fixtures
const FIXTURES_PATH = path.join(__dirname, 'fixtures');
const FIXTURES_PAGES_PATH = path.join(FIXTURES_PATH, 'pages');

/**
 * Create a mock Express request object
 * @param {Object} options - Request options
 * @returns {Object} Mock request
 */
function createMockRequest(options = {}) {
  return {
    path: options.path || '/',
    originalUrl: options.originalUrl || options.path || '/',
    query: options.query || {},
    params: options.params || {},
    body: options.body || {},
    headers: options.headers || {},
    get: function(name) {
      return this.headers[name.toLowerCase()] || null;
    },
    accepts: function(type) {
      const accept = this.headers['accept'] || '';
      return accept.includes(type);
    },
    ...options
  };
}

/**
 * Create a mock Express response object
 * @returns {Object} Mock response with tracking
 */
function createMockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    _ended: false,
    
    status(code) {
      this.statusCode = code;
      return this;
    },
    
    set(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    
    send(body) {
      this.body = body;
      this._ended = true;
      return this;
    },
    
    json(data) {
      this.headers['content-type'] = 'application/json';
      this.body = JSON.stringify(data);
      this._ended = true;
      return this;
    },
    
    render(view, data, callback) {
      this.renderedView = view;
      this.renderedData = data;
      if (callback) callback(null, '<html></html>');
      return this;
    },
    
    on(event, callback) {
      // Mock event listener
      return this;
    }
  };
  
  return res;
}

/**
 * Create a mock Express next function
 * @returns {Function} Mock next function with tracking
 */
function createMockNext() {
  const next = (err) => {
    next.called = true;
    next.error = err || null;
  };
  next.called = false;
  next.error = null;
  return next;
}

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
 * Wait for a specified time
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise}
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  createTestContext,
  wait,
  createTempFile,
  removeTempFile,
  cleanupTempDir
};

// Make utilities available globally in tests
global.testUtils = module.exports;



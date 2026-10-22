/**
 * Standard File System & Sandbox Test Utilities
 * Provides safe, isolated temporary directories and file helpers with automatic cleanup.
 * @module tests/utils/fs
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/**
 * Creates a unique temporary directory.
 *
 * @param {string} [prefix='webspresso-test-'] - Directory prefix
 * @returns {string} Absolute path to created temporary directory
 */
function createTempDir(prefix = 'webspresso-test-') {
  const safePrefix = prefix.endsWith('-') ? prefix : `${prefix}-`;
  return fs.mkdtempSync(path.join(os.tmpdir(), safePrefix));
}

/**
 * Safely removes a directory and all its contents recursively.
 *
 * @param {string} dirPath - Directory path to remove
 */
function cleanupDir(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') return;
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch (_) {
    // Ignore errors during cleanup (e.g. transient locks)
  }
}

/**
 * Writes multiple files to a directory from an object map.
 * Creates parent directories automatically.
 *
 * @param {string} baseDir - Base directory
 * @param {Record<string, string|Buffer>} filesMap - Relative path to file content mapping
 */
function writeTempFiles(baseDir, filesMap = {}) {
  for (const [relPath, content] of Object.entries(filesMap)) {
    const fullPath = path.join(baseDir, relPath);
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content);
  }
}

/**
 * Creates an isolated temporary sandbox with file manipulation helpers.
 *
 * @param {string} [prefix='webspresso-sandbox-'] - Prefix for directory name
 * @returns {Object} Sandbox instance
 */
function createTempSandbox(prefix = 'webspresso-sandbox-') {
  const dir = createTempDir(prefix);

  const resolvePath = (...parts) => path.join(dir, ...parts);

  const writeFile = (relPath, content) => {
    const fullPath = resolvePath(relPath);
    const parent = path.dirname(fullPath);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.writeFileSync(fullPath, content);
    return fullPath;
  };

  const writeFiles = (filesMap) => {
    writeTempFiles(dir, filesMap);
  };

  const readFile = (relPath, encoding = 'utf8') => {
    return fs.readFileSync(resolvePath(relPath), encoding);
  };

  const exists = (relPath) => {
    return fs.existsSync(resolvePath(relPath));
  };

  const mkdir = (relPath) => {
    const fullPath = resolvePath(relPath);
    fs.mkdirSync(fullPath, { recursive: true });
    return fullPath;
  };

  const removeFile = (relPath) => {
    const fullPath = resolvePath(relPath);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  };

  const cleanup = () => {
    cleanupDir(dir);
  };

  return {
    dir,
    resolvePath,
    writeFile,
    writeFiles,
    readFile,
    exists,
    mkdir,
    removeFile,
    cleanup,
  };
}

/**
 * Executes a callback within a temporary directory sandbox, guaranteeing cleanup on completion.
 *
 * @template T
 * @param {(sandbox: ReturnType<typeof createTempSandbox>) => Promise<T>|T} callback - Test callback
 * @param {Object} [options={}] - Options
 * @param {string} [options.prefix='webspresso-temp-'] - Directory prefix
 * @returns {Promise<T>} Result of callback
 */
async function withTempDir(callback, options = {}) {
  const sandbox = createTempSandbox(options.prefix || 'webspresso-temp-');
  try {
    return await callback(sandbox);
  } finally {
    sandbox.cleanup();
  }
}

module.exports = {
  createTempDir,
  cleanupDir,
  writeTempFiles,
  createTempSandbox,
  withTempDir,
};

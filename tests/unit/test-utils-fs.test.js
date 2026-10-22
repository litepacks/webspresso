const fs = require('fs');
const path = require('path');
const {
  createTempDir,
  cleanupDir,
  writeTempFiles,
  createTempSandbox,
  withTempDir,
} = require('../utils/fs');

describe('Test Utilities - FS Sandbox (Step 3)', () => {
  describe('createTempDir and cleanupDir', () => {
    it('creates a unique temporary directory and safely cleans it up', () => {
      const dir = createTempDir('test-dir-');
      expect(fs.existsSync(dir)).toBe(true);
      expect(path.basename(dir)).toContain('test-dir-');

      cleanupDir(dir);
      expect(fs.existsSync(dir)).toBe(false);

      // Safe to call again on non-existent directory
      expect(() => cleanupDir(dir)).not.toThrow();
      expect(() => cleanupDir(null)).not.toThrow();
    });
  });

  describe('writeTempFiles', () => {
    it('writes nested directory files from an object map', () => {
      const dir = createTempDir('test-files-');
      try {
        writeTempFiles(dir, {
          'pages/index.njk': '<h1>Home</h1>',
          'pages/api/notes.get.js': 'module.exports = {}',
          'config/settings.json': JSON.stringify({ ok: true }),
        });

        expect(fs.existsSync(path.join(dir, 'pages/index.njk'))).toBe(true);
        expect(fs.readFileSync(path.join(dir, 'pages/index.njk'), 'utf8')).toBe('<h1>Home</h1>');

        expect(fs.existsSync(path.join(dir, 'pages/api/notes.get.js'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'config/settings.json'))).toBe(true);
      } finally {
        cleanupDir(dir);
      }
    });
  });

  describe('createTempSandbox', () => {
    it('provides isolated file management helpers', () => {
      const sandbox = createTempSandbox('sandbox-test-');
      try {
        expect(fs.existsSync(sandbox.dir)).toBe(true);

        sandbox.writeFile('sub/hello.txt', 'Hello World');
        expect(sandbox.exists('sub/hello.txt')).toBe(true);
        expect(sandbox.readFile('sub/hello.txt')).toBe('Hello World');

        sandbox.writeFiles({
          'a.txt': 'A',
          'b/c.txt': 'C',
        });
        expect(sandbox.readFile('a.txt')).toBe('A');
        expect(sandbox.readFile('b/c.txt')).toBe('C');

        sandbox.removeFile('a.txt');
        expect(sandbox.exists('a.txt')).toBe(false);
      } finally {
        sandbox.cleanup();
        expect(fs.existsSync(sandbox.dir)).toBe(false);
      }
    });
  });

  describe('withTempDir', () => {
    it('executes callback with sandbox and guarantees cleanup on success', async () => {
      let createdDir = null;

      const result = await withTempDir(async (sb) => {
        createdDir = sb.dir;
        expect(fs.existsSync(createdDir)).toBe(true);

        sb.writeFile('data.json', JSON.stringify({ count: 42 }));
        return sb.readFile('data.json');
      });

      expect(JSON.parse(result)).toEqual({ count: 42 });
      expect(fs.existsSync(createdDir)).toBe(false);
    });

    it('guarantees cleanup even when the test callback throws', async () => {
      let createdDir = null;

      await expect(
        withTempDir(async (sb) => {
          createdDir = sb.dir;
          expect(fs.existsSync(createdDir)).toBe(true);
          throw new Error('intentional_test_failure');
        })
      ).rejects.toThrow('intentional_test_failure');

      expect(fs.existsSync(createdDir)).toBe(false);
    });
  });
});

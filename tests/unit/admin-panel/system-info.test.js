/**
 * Unit tests for Admin Panel System Info & Version Check API
 */

const {
  getWebspressoVersion,
  compareSemver,
  formatUptime,
  formatBytes,
  createExtensionApiHandlers,
} = require('../../../plugins/admin-panel/core/api-extensions');

describe('Admin Panel System Info & Version Helpers', () => {
  describe('getWebspressoVersion', () => {
    it('returns a valid semver string', () => {
      const version = getWebspressoVersion();
      expect(typeof version).toBe('string');
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('compareSemver', () => {
    it('correctly compares semantic versions', () => {
      expect(compareSemver('0.0.91', '0.0.90')).toBe(1);
      expect(compareSemver('0.1.0', '0.0.90')).toBe(1);
      expect(compareSemver('1.0.0', '0.9.9')).toBe(1);
      expect(compareSemver('0.0.90', '0.0.90')).toBe(0);
      expect(compareSemver('0.0.89', '0.0.90')).toBe(-1);
      expect(compareSemver('v0.0.91', '0.0.90')).toBe(1);
      expect(compareSemver(null, '0.0.90')).toBe(0);
      expect(compareSemver('0.0.90', null)).toBe(0);
    });
  });

  describe('formatUptime', () => {
    it('formats seconds into human readable time', () => {
      expect(formatUptime(45)).toBe('45s');
      expect(formatUptime(125)).toBe('2m 5s');
      expect(formatUptime(3665)).toBe('1h 1m 5s');
      expect(formatUptime(90000)).toBe('1d 1h');
      expect(formatUptime(0)).toBe('0s');
    });
  });

  describe('formatBytes', () => {
    it('formats bytes into megabytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
      expect(formatBytes(50 * 1024 * 1024)).toBe('50.0 MB');
      expect(formatBytes(0)).toBe('0 MB');
    });
  });

  describe('systemInfoHandler', () => {
    it('returns system runtime info and version comparison', async () => {
      const handlers = createExtensionApiHandlers({
        registry: { settings: {} },
        db: { knex: { client: { config: { client: 'sqlite3' } } } },
      });

      const req = { query: {} };
      let responseData = null;
      let statusCode = 200;
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(data) {
          responseData = data;
          return this;
        },
      };

      await handlers.systemInfoHandler(req, res);

      expect(statusCode).toBe(200);
      expect(responseData).toBeDefined();
      expect(responseData.success).toBe(true);
      expect(responseData.webspressoVersion).toBeDefined();
      expect(responseData.nodeVersion).toBe(process.version);
      expect(responseData.platform).toBeDefined();
      expect(responseData.arch).toBe(process.arch);
      expect(responseData.environment).toBeDefined();
      expect(responseData.uptimeFormatted).toBeDefined();
      expect(responseData.memory).toBeDefined();
      expect(responseData.memory.heapUsed).toContain('MB');
      expect(responseData.database.client).toBe('sqlite3');
    });
  });
});

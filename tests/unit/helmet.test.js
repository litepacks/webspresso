/**
 * Helmet Configuration Tests
 */

const { createApp } = require('../../src/server');
const path = require('path');
const request = require('supertest');

describe('Helmet Configuration', () => {
  const pagesDir = path.join(__dirname, '../fixtures/pages');
  const viewsDir = path.join(__dirname, '../fixtures/views');

  describe('Default Configuration', () => {
    it('should use default helmet config in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';

        const { app } = createApp({ pagesDir, viewsDir });
        const res = await request(app).get('/');

        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBe('DENY');
        expect(res.headers['x-xss-protection']).toBe('0');
        expect(res.headers['strict-transport-security']).toBeDefined();
        expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('should disable CSP in development', async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'development';

        const { app } = createApp({ pagesDir, viewsDir });
        const res = await request(app).get('/');

        // CSP should not be set in development
        expect(res.headers['content-security-policy']).toBeUndefined();
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('Custom Configuration', () => {
    it('should allow disabling helmet', async () => {
      const { app } = createApp({ 
        pagesDir, 
        viewsDir,
        helmet: false
      });
      
      const res = await request(app).get('/');
      
      // Security headers should not be present
      expect(res.headers['x-content-type-options']).toBeUndefined();
      expect(res.headers['x-frame-options']).toBeUndefined();
    });

    it('should merge custom helmet config with defaults', async () => {
      const { app } = createApp({ 
        pagesDir, 
        viewsDir,
        helmet: {
          frameguard: { action: 'sameorigin' }
        }
      });
      
      const res = await request(app).get('/');
      
      // Custom config should be applied
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      // Default configs should still be present
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('should use true to enable default config', async () => {
      const { app } = createApp({ 
        pagesDir, 
        viewsDir,
        helmet: true
      });
      
      const res = await request(app).get('/');
      
      // Default security headers should be present
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
    });
  });

  /**
   * createApp does shallow merge: `{ ...getDefaultHelmetConfig(), ...userHelmet }`.
   * Deeper fields (e.g. CSP `directives`) are not merged — a user `contentSecurityPolicy`
   * object replaces the entire default `contentSecurityPolicy` value.
   */
  describe('Shallow merge and duplicate / overlapping options', () => {
    it('user hsts: false overwrites default HSTS in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const { app } = createApp({
          pagesDir,
          viewsDir,
          helmet: { hsts: false },
        });
        const res = await request(app).get('/');
        expect(res.headers['strict-transport-security']).toBeUndefined();
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('user referrer policy overrides default (same key, last spread wins)', async () => {
      const { app } = createApp({
        pagesDir,
        viewsDir,
        helmet: { referrerPolicy: { policy: 'no-referrer' } },
      });
      const res = await request(app).get('/');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
    });

    it('user contentSecurityPolicy replaces createApp default object (shallow); Helmet can still add directives', async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';

        const { app: withDefault } = createApp({ pagesDir, viewsDir });
        const cspFromDefault = (await request(withDefault).get('/')).headers['content-security-policy'] || '';
        expect(cspFromDefault).toMatch(/img-src/);

        // Any URL that does not appear in the stock default CSP proves the user bundle was passed in.
        const userOnlySrc = 'https://helmet-shallow-user.test';
        const { app: withUser } = createApp({
          pagesDir,
          viewsDir,
          helmet: {
            contentSecurityPolicy: {
              directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", userOnlySrc],
                styleSrc: ["'self'", "'unsafe-inline'"],
              },
            },
          },
        });
        const cspUser = (await request(withUser).get('/')).headers['content-security-policy'] || '';
        expect(cspUser).toContain(userOnlySrc);
        expect(cspFromDefault).not.toContain(userOnlySrc);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('user contentSecurityPolicy: false turns off CSP in production (overrides default object)', async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const { app } = createApp({
          pagesDir,
          viewsDir,
          helmet: { contentSecurityPolicy: false },
        });
        const res = await request(app).get('/');
        expect(res.headers['content-security-policy']).toBeUndefined();
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('plugin csp is appended to existing directive arrays (not replace)', async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const { app } = createApp({
          pagesDir,
          viewsDir,
          plugins: [
            {
              name: 'e2e-csp-plugin',
              csp: { scriptSrc: 'https://cdn.example.test' },
            },
          ],
        });
        const csp = (await request(app).get('/')).headers['content-security-policy'] || '';
        expect(csp).toContain('https://cdn.example.test');
        expect(csp).toMatch(/script-src[^;]*'self'/);
        const selfCount = csp.split("'self'").length - 1;
        expect(selfCount).toBeGreaterThanOrEqual(1);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('plugin csp + default: duplicate \'self\' in script-src can happen (array concat, not deduped against base)', async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const { app } = createApp({
          pagesDir,
          viewsDir,
          plugins: [
            {
              name: 'e2e-csp-dup',
              csp: { scriptSrc: ["'self'", 'https://unique.plugin.source'] },
            },
          ],
        });
        const csp = (await request(app).get('/')).headers['content-security-policy'] || '';
        expect(csp).toContain('https://unique.plugin.source');
        const scriptIdx = csp.indexOf('script-src');
        const end = csp.indexOf(';', scriptIdx);
        const scriptPart = end === -1 ? csp.slice(scriptIdx) : csp.slice(scriptIdx, end);
        const selfOccurrences = (scriptPart.match(/'self'/g) || []).length;
        // Default already has 'self'; merge does [...default, ...pluginSet] — 'self' appears twice
        expect(selfOccurrences).toBe(2);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('two plugins with same directive and same URL: Set dedupes — no error, source once from plugin merge', async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const shared = 'https://two-plugins-same-directive.test';
        const { app } = createApp({
          pagesDir,
          viewsDir,
          plugins: [
            { name: 'csp-p1', csp: { scriptSrc: shared } },
            { name: 'csp-p2', csp: { scriptSrc: shared } },
          ],
        });
        const csp = (await request(app).get('/')).headers['content-security-policy'] || '';
        expect(csp).toContain(shared);
        expect(csp.split(shared).length - 1).toBe(1);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
});


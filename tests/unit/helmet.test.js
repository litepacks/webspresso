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
});


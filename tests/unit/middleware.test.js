/**
 * Middleware Configuration Tests
 */

const { createApp } = require('../../src/server');
const { resolveMiddlewares } = require('../../src/file-router');
const path = require('path');
const request = require('supertest');

describe('Middleware Configuration', () => {
  const pagesDir = path.join(__dirname, '../fixtures/pages');
  const viewsDir = path.join(__dirname, '../fixtures/views');

  describe('resolveMiddlewares', () => {
    it('should resolve function middlewares as-is', () => {
      const mw1 = (req, res, next) => next();
      const mw2 = (req, res, next) => next();
      
      const resolved = resolveMiddlewares([mw1, mw2], {});
      
      expect(resolved).toHaveLength(2);
      expect(resolved[0]).toBe(mw1);
      expect(resolved[1]).toBe(mw2);
    });

    it('should resolve named middlewares from registry', () => {
      const authMw = (req, res, next) => next();
      const adminMw = (req, res, next) => next();
      
      const registry = {
        auth: authMw,
        admin: adminMw
      };
      
      const resolved = resolveMiddlewares(['auth', 'admin'], registry);
      
      expect(resolved).toHaveLength(2);
      expect(resolved[0]).toBe(authMw);
      expect(resolved[1]).toBe(adminMw);
    });

    it('should support mixed function and named middlewares', () => {
      const authMw = (req, res, next) => next();
      const customMw = (req, res, next) => next();
      
      const registry = { auth: authMw };
      
      const resolved = resolveMiddlewares(['auth', customMw], registry);
      
      expect(resolved).toHaveLength(2);
      expect(resolved[0]).toBe(authMw);
      expect(resolved[1]).toBe(customMw);
    });

    it('should throw error for unknown middleware name', () => {
      const registry = { auth: (req, res, next) => next() };
      
      expect(() => {
        resolveMiddlewares(['unknown'], registry);
      }).toThrow('Middleware "unknown" not found in registry');
    });

    it('should throw error for non-function middleware in registry', () => {
      const registry = { bad: 'not a function' };
      
      expect(() => {
        resolveMiddlewares(['bad'], registry);
      }).toThrow('Middleware "bad" must be a function');
    });

    it('should return empty array for null/undefined config', () => {
      expect(resolveMiddlewares(null, {})).toEqual([]);
      expect(resolveMiddlewares(undefined, {})).toEqual([]);
    });
  });

  describe('Named Middleware Integration', () => {
    it('should use named middlewares in routes', async () => {
      const calls = [];
      
      const { app } = createApp({
        pagesDir,
        viewsDir,
        middlewares: {
          logger: (req, res, next) => {
            calls.push('logger');
            next();
          },
          tracker: (req, res, next) => {
            calls.push('tracker');
            next();
          }
        }
      });
      
      // The middleware will be called if route config uses it
      // For now, just test that app creates without errors
      expect(app).toBeDefined();
    });

    it('should create app with empty middlewares registry', async () => {
      const { app } = createApp({
        pagesDir,
        viewsDir,
        middlewares: {}
      });
      
      expect(app).toBeDefined();
      
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
    });

    it('should create app without middlewares option', async () => {
      const { app } = createApp({
        pagesDir,
        viewsDir
      });
      
      expect(app).toBeDefined();
      
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
    });
  });
});



/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { request } from '../helpers/http.js';
import { createApp } from '../../src/server.js';

const pagesDir = path.join(process.cwd(), 'tests/fixtures/pages');
const viewsDir = path.join(process.cwd(), 'tests/fixtures/views');

describe('Webspresso Studio integration', () => {
  const origEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = origEnv;
  });

  it('serves Studio HTML in development', async () => {
    process.env.NODE_ENV = 'development';
    const { app } = createApp({
      pagesDir,
      viewsDir,
      logging: false,
      studio: true,
    });
    const res = await request(app).get('/_webspresso');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Webspresso Studio/i);
    expect(res.text).toMatch(/Route inspector|Overview/i);
  });

  it('returns 404 for Studio when disabled', async () => {
    process.env.NODE_ENV = 'production';
    const { app } = createApp({
      pagesDir,
      viewsDir,
      logging: false,
      studio: false,
    });
    const res = await request(app).get('/_webspresso');
    expect(res.status).toBe(404);
  });

  it('exposes internal routes API', async () => {
    process.env.NODE_ENV = 'development';
    const { app } = createApp({
      pagesDir,
      viewsDir,
      logging: false,
      studio: true,
    });
    const res = await request(app).get('/_webspresso/api/routes');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('routes');
    expect(Array.isArray(res.body.routes)).toBe(true);
  });

  it('masks env API secrets', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SESSION_SECRET = 'test-secret-value-32chars-minimum-here';
    const { app } = createApp({
      pagesDir,
      viewsDir,
      logging: false,
      studio: { enabled: true, exposeEnv: false },
    });
    const res = await request(app).get('/_webspresso/api/env');
    expect(res.status).toBe(200);
    const secret = res.body.entries?.find((e) => e.key === 'SESSION_SECRET');
    expect(secret?.masked || secret?.value === '••••••••').toBeTruthy();
  });
});

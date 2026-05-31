/**
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { request } from '../helpers/http.js';
import { createApp } from '../../src/server.js';

const pagesDir = path.join(process.cwd(), 'tests/fixtures/pages');
const viewsDir = path.join(process.cwd(), 'tests/fixtures/views');

describe('Studio security', () => {
  it('cache clear rejects GET', async () => {
    process.env.NODE_ENV = 'development';
    const { app } = createApp({
      pagesDir,
      viewsDir,
      logging: false,
      studio: { enabled: true, cacheActions: true },
    });
    const res = await request(app).get('/_webspresso/api/cache/clear');
    expect(res.status).toBe(405);
  });

  it('requires basic auth in production when enabled', async () => {
    process.env.NODE_ENV = 'production';
    const { app } = createApp({
      pagesDir,
      viewsDir,
      logging: false,
      studio: {
        enabled: true,
        auth: 'basic',
        basicAuth: { user: 'studio', pass: 'test-pass' },
      },
    });
    const unauth = await request(app).get('/_webspresso');
    expect(unauth.status).toBe(401);
    const token = Buffer.from('studio:test-pass').toString('base64');
    const auth = await request(app)
      .get('/_webspresso')
      .set('Authorization', `Basic ${token}`);
    expect(auth.status).toBe(200);
  });
});

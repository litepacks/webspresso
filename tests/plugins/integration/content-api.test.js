/**
 * Content plugin API integration tests
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { clearRegistry } from '../../../index.js';
import {
  createContentTestApp,
  loginAdmin,
  seedHeroContent,
} from '../../fixtures/content-test-setup.js';

describe('content plugin API', () => {
  let app;
  let db;
  let cookie;
  let contentService;

  beforeAll(async () => {
    ({ app, db, contentService } = await createContentTestApp({ pagesDir: './tests/fixtures/empty-pages' }));
    cookie = await loginAdmin(request, app);
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  beforeEach(async () => {
    await db.knex('content_entries').delete();
    await db.knex('content_types').delete();
    if (contentService?.invalidateCache) {
      contentService.invalidateCache();
    }
  });

  it('rejects admin API without auth', async () => {
    await request(app).get('/_admin/api/content/types').expect(401);
  });

  it('creates content via admin API and reads via public API', async () => {
    await seedHeroContent(request, app, cookie);

    const pub = await request(app).get('/api/content/hero/home').expect(200);
    expect(pub.body.data.headline).toBe('Hello CMS');
    expect(pub.body.type).toBe('hero');
  });

  it('does not expose draft entries on public API', async () => {
    await request(app)
      .post('/_admin/api/content/types')
      .set('Cookie', cookie)
      .send({
        slug: 'note',
        name: 'Note',
        schema: { fields: [{ name: 'body', type: 'text' }] },
      })
      .expect(201);

    await request(app)
      .post('/_admin/api/content/types/note/entries')
      .set('Cookie', cookie)
      .send({
        slug: 'secret',
        status: 'draft',
        data: { body: 'hidden' },
      })
      .expect(201);

    await request(app).get('/api/content/note/secret').expect(404);
  });

  it('rejects duplicate entry slug per type', async () => {
    await seedHeroContent(request, app, cookie);

    await request(app)
      .post('/_admin/api/content/types/hero/entries')
      .set('Cookie', cookie)
      .send({ slug: 'home', data: { headline: 'Dup' } })
      .expect(400);
  });

  it('cascades entry delete when type is deleted', async () => {
    const { type } = await seedHeroContent(request, app, cookie);

    await request(app)
      .delete(`/_admin/api/content/types/${type.id}`)
      .set('Cookie', cookie)
      .expect(200);

    await request(app).get('/api/content/hero/home').expect(404);
  });
});

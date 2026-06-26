/**
 * Content plugin API contract tests — stable response shapes.
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { clearRegistry } from '../../index.js';
import {
  createContentTestApp,
  loginAdmin,
  seedHeroContent,
  SAMPLE_TYPE_SCHEMA,
} from '../fixtures/content-test-setup.js';
import {
  assertErrorContract,
  assertAdminListEnvelopeContract,
  assertAdminDataEnvelopeContract,
  assertAdminSuccessContract,
  assertPublicEntryContract,
  assertTypeSchemaResponseContract,
  assertEntryWithTypeContract,
  assertContentTypeRecordContract,
  assertContentEntryRecordContract,
} from '../fixtures/content-contracts.js';

describe('content plugin API contracts', () => {
  let app;
  let db;
  let cookie;

  beforeEach(async () => {
    ({ app, db } = await createContentTestApp());
    cookie = await loginAdmin(request, app);
  });

  afterEach(async () => {
    if (db) await db.destroy();
    clearRegistry();
  });

  describe('error envelope', () => {
    it('401 admin routes return { error }', async () => {
      const res = await request(app).get('/_admin/api/content/types').expect(401);
      assertErrorContract(res.body, { allowRedirect: true });
    });

    it('404 public routes return { error }', async () => {
      const res = await request(app).get('/api/content/missing/nope').expect(404);
      assertErrorContract(res.body);
    });

    it('400 validation returns { error }', async () => {
      const res = await request(app)
        .post('/_admin/api/content/types')
        .set('Cookie', cookie)
        .send({ slug: 'INVALID SLUG', name: 'Bad' })
        .expect(400);
      assertErrorContract(res.body);
    });
  });

  describe('admin content types', () => {
    it('GET /types — list envelope', async () => {
      await seedHeroContent(request, app, cookie);
      const res = await request(app)
        .get('/_admin/api/content/types')
        .set('Cookie', cookie)
        .expect(200);
      assertAdminListEnvelopeContract(res.body);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      assertContentTypeRecordContract(res.body.data[0]);
    });

    it('POST /types — 201 + data record', async () => {
      const res = await request(app)
        .post('/_admin/api/content/types')
        .set('Cookie', cookie)
        .send({
          slug: 'faq',
          name: 'FAQ',
          schema: { fields: [{ name: 'question', type: 'text' }] },
        })
        .expect(201);
      assertAdminDataEnvelopeContract(res.body);
      assertContentTypeRecordContract(res.body.data);
      expect(res.body.data.slug).toBe('faq');
    });

    it('GET /types/:id — single type', async () => {
      const { type } = await seedHeroContent(request, app, cookie);
      const res = await request(app)
        .get(`/_admin/api/content/types/${type.id}`)
        .set('Cookie', cookie)
        .expect(200);
      assertAdminDataEnvelopeContract(res.body);
      assertContentTypeRecordContract(res.body.data);
    });

    it('PUT /types/:id — updated record', async () => {
      const { type } = await seedHeroContent(request, app, cookie);
      const res = await request(app)
        .put(`/_admin/api/content/types/${type.id}`)
        .set('Cookie', cookie)
        .send({ name: 'Hero Updated' })
        .expect(200);
      assertAdminDataEnvelopeContract(res.body);
      expect(res.body.data.name).toBe('Hero Updated');
    });

    it('GET /types/:typeSlug/schema — schema subset', async () => {
      await seedHeroContent(request, app, cookie);
      const res = await request(app)
        .get('/_admin/api/content/types/hero/schema')
        .set('Cookie', cookie)
        .expect(200);
      assertTypeSchemaResponseContract(res.body);
      expect(res.body.data.slug).toBe('hero');
      expect(res.body.data.schema.fields).toHaveLength(SAMPLE_TYPE_SCHEMA.fields.length);
    });

    it('DELETE /types/:id — { success: true }', async () => {
      const { type } = await seedHeroContent(request, app, cookie);
      const res = await request(app)
        .delete(`/_admin/api/content/types/${type.id}`)
        .set('Cookie', cookie)
        .expect(200);
      assertAdminSuccessContract(res.body);
    });
  });

  describe('admin content entries', () => {
    it('GET /types/:typeSlug/entries — list envelope', async () => {
      await seedHeroContent(request, app, cookie);
      const res = await request(app)
        .get('/_admin/api/content/types/hero/entries')
        .set('Cookie', cookie)
        .expect(200);
      assertAdminListEnvelopeContract(res.body);
      assertContentEntryRecordContract(res.body.data[0]);
    });

    it('POST /types/:typeSlug/entries — 201 + entry', async () => {
      await request(app)
        .post('/_admin/api/content/types')
        .set('Cookie', cookie)
        .send({
          slug: 'banner',
          name: 'Banner',
          schema: { fields: [{ name: 'text', type: 'text' }] },
        })
        .expect(201);

      const res = await request(app)
        .post('/_admin/api/content/types/banner/entries')
        .set('Cookie', cookie)
        .send({ slug: 'top', data: { text: 'Hi' } })
        .expect(201);
      assertAdminDataEnvelopeContract(res.body);
      assertContentEntryRecordContract(res.body.data);
    });

    it('GET /entries/:id — entry + type', async () => {
      const { entry } = await seedHeroContent(request, app, cookie);
      const res = await request(app)
        .get(`/_admin/api/content/entries/${entry.id}`)
        .set('Cookie', cookie)
        .expect(200);
      assertEntryWithTypeContract(res.body);
    });

    it('PUT /entries/:id — bumps revision', async () => {
      const { entry } = await seedHeroContent(request, app, cookie);
      const res = await request(app)
        .put(`/_admin/api/content/entries/${entry.id}`)
        .set('Cookie', cookie)
        .send({ data: { headline: 'Updated' } })
        .expect(200);
      assertAdminDataEnvelopeContract(res.body);
      expect(res.body.data.revision).toBe(2);
      expect(res.body.data.data.headline).toBe('Updated');
    });

    it('DELETE /entries/:id — { success: true }', async () => {
      const { entry } = await seedHeroContent(request, app, cookie);
      const res = await request(app)
        .delete(`/_admin/api/content/entries/${entry.id}`)
        .set('Cookie', cookie)
        .expect(200);
      assertAdminSuccessContract(res.body);
    });
  });

  describe('public API', () => {
    it('GET /api/content/:type/:slug — published entry contract', async () => {
      await seedHeroContent(request, app, cookie);
      const res = await request(app).get('/api/content/hero/home').expect(200);
      assertPublicEntryContract(res.body);
      expect(res.body.data.headline).toBe('Hello CMS');
      expect(res.body.meta.status).toBe('published');
    });

    it('draft entries are absent from public contract (404)', async () => {
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
        .send({ slug: 'draft-only', status: 'draft', data: { body: 'x' } })
        .expect(201);

      const res = await request(app).get('/api/content/note/draft-only').expect(404);
      assertErrorContract(res.body);
    });
  });
});

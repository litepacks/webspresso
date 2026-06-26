/**
 * Content inline edit + template helper integration tests
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { clearRegistry } from '../../index.js';
import { createContentTestApp, loginAdmin } from '../fixtures/content-test-setup.js';
import { createRequestContentHelpers } from '../../plugins/content/helpers.js';
import { wrapEditable, wrapEntryBlock } from '../../core/content/index.js';

describe('content inline edit & helpers', () => {
  let app;
  let db;

  beforeEach(async () => {
    ({ app, db } = await createContentTestApp());
  });

  afterEach(async () => {
    if (db) await db.destroy();
    clearRegistry();
  });

  it('does not inject inline edit assets for anonymous users', async () => {
    const res = await request(app).get('/').expect(200);
    expect(res.text).not.toContain('ws-content-inline-edit');
    expect(res.text).not.toContain('window.__WS_CONTENT__');
    expect(res.text).not.toContain('ws-content-edit-btn');
  });

  it('injects inline edit config + script for admin session', async () => {
    const cookie = await loginAdmin(request, app);
    const res = await request(app).get('/').set('Cookie', cookie).expect(200);
    expect(res.text).toContain('id="ws-content-inline-edit"');
    expect(res.text).toContain('window.__WS_CONTENT__');
    expect(res.text).toContain('/_admin');
    expect(res.text).toContain('ws-content-modal');
  });

  it('skips inline edit when inlineEdit: false', async () => {
    if (db) await db.destroy();
    clearRegistry();
    ({ app, db } = await createContentTestApp({ inlineEdit: false }));
    const cookie = await loginAdmin(request, app);
    const res = await request(app).get('/').set('Cookie', cookie).expect(200);
    expect(res.text).not.toContain('ws-content-inline-edit');
  });

  describe('fsy.content helpers', () => {
    it('editable() omits wrapper for non-admin', () => {
      const build = createRequestContentHelpers({ adminPath: '/_admin' });
      const helpers = build({ session: {} });
      expect(helpers.isAdmin()).toBe(false);
      expect(helpers.editable('Hello', { entryId: 1, typeSlug: 'hero', field: 'headline' }))
        .toBe('Hello');
    });

    it('editable() adds data attributes for admin', () => {
      const build = createRequestContentHelpers();
      const helpers = build({ session: { adminUser: { id: 1 } } });
      expect(helpers.isAdmin()).toBe(true);
      const html = helpers.editable('Hello', {
        entryId: 5,
        typeSlug: 'hero',
        field: 'headline',
        label: 'Headline',
      });
      expect(html).toContain('data-ws-content-entry="5"');
      expect(html).toContain('data-ws-content-type="hero"');
      expect(html).toContain('data-ws-content-field="headline"');
      expect(html).toContain('ws-content-editable');
    });

    it('editable() escapes HTML for non-rich fields', () => {
      const build = createRequestContentHelpers();
      const helpers = build({ session: { adminUser: {} } });
      const html = helpers.editable('<script>', { entryId: 1, typeSlug: 'x', field: 't' });
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('block() wraps entry region for admin only', () => {
      const inner = '<p>Block</p>';
      const admin = wrapEntryBlock(inner, { entryId: 2, typeSlug: 'faq', isAdmin: true });
      expect(admin).toContain('ws-content-block');
      expect(admin).toContain('data-ws-content-entry="2"');
      const pub = wrapEntryBlock(inner, { entryId: 2, typeSlug: 'faq', isAdmin: false });
      expect(pub).toBe(inner);
    });

    it('raw() returns entry data object', () => {
      const build = createRequestContentHelpers();
      const helpers = build({ session: {} });
      expect(helpers.raw({ data: { a: 1 } })).toEqual({ a: 1 });
      expect(helpers.raw(null)).toEqual({});
    });
  });

  describe('renderer', () => {
    it('wrapEditable supports safeHtml flag', () => {
      const html = wrapEditable('<em>x</em>', {
        entryId: 1,
        typeSlug: 'hero',
        field: 'body',
        isAdmin: true,
        safeHtml: true,
      });
      expect(html).toContain('data-ws-content-html="true"');
      expect(html).toContain('<em>x</em>');
    });
  });
});

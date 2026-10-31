/**
 * Production must never fall back to the well-known development secrets
 * used for OAuth state signing and admin panel session cookies.
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const path = require('path');
const request = require('supertest');
const { OAuthClient } = require('../../../core/auth/oauth');
const { assertStrongSecret } = require('../../../core/auth/manager');
const { createApp } = require('../../../src/server');
const adminPanelPlugin = require('../../../plugins/admin-panel');

const STRONG = 'a3f9c1d2e4b5a6978877665544332211ffeeddccbbaa';
const SECRET_ENV_KEYS = ['NODE_ENV', 'OAUTH_SECRET', 'SESSION_SECRET'];

describe('production secret enforcement', () => {
  let savedEnv;

  beforeEach(() => {
    savedEnv = Object.fromEntries(SECRET_ENV_KEYS.map((k) => [k, process.env[k]]));
    delete process.env.OAUTH_SECRET;
    delete process.env.SESSION_SECRET;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.restoreAllMocks();
  });

  it('treats the framework dev defaults as weak secrets', () => {
    for (const weak of ['webspresso-oauth-secret', 'webspresso-admin-secret-change-in-production']) {
      expect(() => assertStrongSecret('X', weak, true)).toThrow(/Insecure secret/);
    }
    expect(() => assertStrongSecret('X', STRONG, true)).not.toThrow();
  });

  describe('OAuthClient', () => {
    it('refuses to start in production without a secret', () => {
      process.env.NODE_ENV = 'production';
      expect(() => new OAuthClient({})).toThrow(/OAUTH_SECRET \/ oauth.secret is required/);
    });

    it('accepts a strong secret in production', () => {
      process.env.NODE_ENV = 'production';
      expect(new OAuthClient({ secret: STRONG }).secret).toBe(STRONG);
      process.env.OAUTH_SECRET = STRONG;
      expect(new OAuthClient({}).secret).toBe(STRONG);
    });

    it('oauthPlugin does not bypass the check with its own fallback secret', () => {
      const oauthPlugin = require('../../../plugins/oauth');
      process.env.NODE_ENV = 'production';
      expect(() => oauthPlugin({})).toThrow(/OAUTH_SECRET \/ oauth.secret is required/);
      expect(() => oauthPlugin({ secret: STRONG })).not.toThrow();
    });

    it('keeps the development default outside production', () => {
      process.env.NODE_ENV = 'development';
      expect(new OAuthClient({}).secret).toBe('webspresso-oauth-secret');
    });
  });

  describe('adminPanelPlugin', () => {
    const fixtures = path.join(__dirname, '..', '..', 'fixtures');
    const mockDb = {
      getRepository: () => ({ findOne: async () => null, count: async () => 0 }),
      hasModel: () => true,
      registerModel: () => {},
      getAllModels: () => new Map(),
      knex: { schema: { hasTable: async () => true } },
    };

    function buildApp(pluginOptions = {}) {
      return createApp({
        pagesDir: path.join(fixtures, 'empty-pages'),
        viewsDir: path.join(fixtures, 'views'),
        plugins: [adminPanelPlugin({ db: mockDb, ...pluginOptions })],
        logging: false,
      }).app;
    }

    it('does not mount the admin panel in production without a session secret', async () => {
      process.env.NODE_ENV = 'production';
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const app = buildApp();
      await request(app).post('/_admin/api/auth/login').send({ email: 'a@b.c', password: 'x' }).expect(404);
      expect(warn.mock.calls.flat().join(' ')).toMatch(/SESSION_SECRET .* is required/);
    });

    it('mounts the admin panel in production with a strong session secret', async () => {
      process.env.NODE_ENV = 'production';
      const app = buildApp({ sessionSecret: STRONG });
      const res = await request(app).post('/_admin/api/auth/login').send({ email: 'a@b.c', password: 'x' });
      expect(res.status).not.toBe(404);
    });
  });
});

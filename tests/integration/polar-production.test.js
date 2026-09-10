'use strict';

/**
 * Polar production-readiness integration tests
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from '../../src/server.js';
import { createDatabase, defineModel, clearRegistry, zdb } from '../../index.js';
import { quickAuth, hash } from '../../core/auth/index.js';
import polarPlugin from '../../plugins/polar/index.js';
import { rateLimitPlugin } from '../../plugins/rate-limit/index.js';
import { rateLimit } from 'express-rate-limit';
import { polarIpKey, loadIpKeyGenerator } from '../../plugins/polar/src/rate-limit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PAGES = path.join(__dirname, '..', 'fixtures', 'pages');
const FIXTURES_VIEWS = path.join(__dirname, '..', 'fixtures', 'views');

describe('Polar production readiness', () => {
  describe('package exports smoke', () => {
    it('resolves documented import paths', () => {
      expect(require('webspresso/core/auth').createAuth).toBeTypeOf('function');
      expect(require('webspresso/plugins/polar/src/webhooks').verifyPolarWebhook).toBeTypeOf('function');
    });
  });

  describe('rate limit IPv6 validation', () => {
    it('polar keyGenerator passes express-rate-limit v8 validation', () => {
      const ipKeyGenerator = loadIpKeyGenerator();
      expect(ipKeyGenerator).toBeTypeOf('function');
      const keyGen = polarIpKey(ipKeyGenerator, 'polar:webhook');
      expect(() => rateLimit({ windowMs: 60_000, limit: 5, keyGenerator: keyGen })).not.toThrow();
    });
  });

  describe('Polar + rateLimitPlugin startup', () => {
    let db;
    let app;
    let auth;
    let authToken;

    beforeAll(async () => {
      process.env.POLAR_CHECKOUT_URL = 'https://buy.polar.sh/polar_cl_prod_test';
      process.env.POLAR_ORG_SLUG = 'prod-test-org';
      delete process.env.POLAR_ACCESS_TOKEN;

      clearRegistry();
      db = createDatabase({
        client: 'better-sqlite3',
        connection: ':memory:',
        models: './tests/fixtures/models-empty',
      });

      await db.knex.schema.createTable('users', (table) => {
        table.bigIncrements('id').primary();
        table.string('email', 255).unique().notNullable();
        table.string('password', 255).notNullable();
        table.string('tier', 32).notNullable().defaultTo('free');
        table.string('polar_status', 32).notNullable().defaultTo('none');
      });

      const UserModel = defineModel({
        name: 'User',
        table: 'users',
        schema: zdb.schema({
          id: zdb.id(),
          email: zdb.string(),
          password: zdb.string(),
          tier: zdb.string({ default: 'free' }),
          polar_status: zdb.string({ default: 'none' }),
        }),
      });
      db.registerModel(UserModel);

      auth = quickAuth({
        db,
        userModel: 'User',
        session: { secret: 'polar-prod-rl-secret' },
        rememberMe: false,
        jwt: { secret: 'polar-prod-jwt', expiresIn: '1h' },
      });

      const user = await db.getRepository('User').create({
        email: `rl_${Date.now()}@example.com`,
        password: await hash('Password123!'),
        tier: 'free',
      });
      authToken = auth.generateUserToken(user);

      expect(() => {
        ({ app } = createApp({
          pagesDir: FIXTURES_PAGES,
          viewsDir: FIXTURES_VIEWS,
          db,
          auth,
          plugins: [
            rateLimitPlugin(),
            polarPlugin({
              db,
              plans: { pro_monthly: 'prod_rl' },
              tierMapping: { pro: ['pro_monthly'], free: [] },
              rateLimit: true,
            }),
          ],
        }));
      }).not.toThrow();
    });

    afterAll(async () => {
      if (db) await db.destroy();
      clearRegistry();
      delete process.env.POLAR_CHECKOUT_URL;
      delete process.env.POLAR_ORG_SLUG;
    });

    it('checkout works with rate limiters enabled', async () => {
      const res = await request(app)
        .post('/settings/billing/checkout')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Accept', 'application/json')
        .expect(200);

      expect(res.body.url).toContain('polar');
    });
  });

  describe('isPaidUser hook + syncBeforeCheckout', () => {
    let db;
    let app;
    let auth;
    let authToken;
    let userId;

    beforeAll(async () => {
      process.env.POLAR_ACCESS_TOKEN = 'polar_oat_test_sync';
      process.env.POLAR_CHECKOUT_URL = 'https://buy.polar.sh/polar_cl_hook_test';

      clearRegistry();
      db = createDatabase({
        client: 'better-sqlite3',
        connection: ':memory:',
        models: './tests/fixtures/models-empty',
      });

      await db.knex.schema.createTable('users', (table) => {
        table.bigIncrements('id').primary();
        table.string('email', 255).unique().notNullable();
        table.string('password', 255).notNullable();
        table.string('tier', 32).notNullable().defaultTo('free');
      });
      await db.knex.schema.createTable('subscriptions', (table) => {
        table.bigIncrements('id').primary();
        table.integer('user_id').notNullable();
        table.string('plan_tier', 32).notNullable().defaultTo('free');
      });

      const UserModel = defineModel({
        name: 'User',
        table: 'users',
        schema: zdb.schema({
          id: zdb.id(),
          email: zdb.string(),
          password: zdb.string(),
          tier: zdb.string({ default: 'free' }),
        }),
      });
      db.registerModel(UserModel);

      auth = quickAuth({
        db,
        userModel: 'User',
        session: { secret: 'polar-hook-secret' },
        rememberMe: false,
        jwt: { secret: 'polar-hook-jwt', expiresIn: '1h' },
      });

      const user = await db.getRepository('User').create({
        email: `hook_${Date.now()}@example.com`,
        password: await hash('Password123!'),
        tier: 'pro',
      });
      userId = user.id;
      await db.knex('subscriptions').insert({ user_id: userId, plan_tier: 'free' });
      authToken = auth.generateUserToken(user);

      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ active_subscriptions: [] }),
      })));

      ({ app } = createApp({
        pagesDir: FIXTURES_PAGES,
        viewsDir: FIXTURES_VIEWS,
        db,
        auth,
        plugins: [
          polarPlugin({
            db,
            syncBeforeCheckout: false,
            plans: { pro_monthly: 'prod_hook' },
            tierMapping: { pro: ['pro_monthly'], free: [] },
            rateLimit: false,
            hooks: {
              async isPaidUser({ user, knex }) {
                const sub = await knex('subscriptions').where('user_id', user.id).first();
                return sub?.plan_tier === 'pro';
              },
            },
          }),
        ],
      }));
    });

    afterAll(async () => {
      vi.unstubAllGlobals();
      if (db) await db.destroy();
      clearRegistry();
      delete process.env.POLAR_ACCESS_TOKEN;
      delete process.env.POLAR_CHECKOUT_URL;
    });

    it('does not redirect already_pro when users.tier is pro but external table is free', async () => {
      const res = await request(app)
        .get('/settings/billing/checkout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(302);

      expect(res.header.location).toContain('polar');
      expect(res.header.location).not.toContain('already_pro');
    });
  });
});

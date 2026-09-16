'use strict';

/**
 * Polar plugin integration tests
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from '../../src/server.js';
import { createDatabase, defineModel, clearRegistry, zdb } from '../../index.js';
import { quickAuth, hash } from '../../core/auth/index.js';
import polarPlugin from '../../plugins/polar/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PAGES = path.join(__dirname, '..', 'fixtures', 'pages');
const FIXTURES_VIEWS = path.join(__dirname, '..', 'fixtures', 'views');

describe.sequential('Polar plugin integration', () => {
  const webhookSecret = `whsec_${Buffer.from('my-super-secret-key-1234567890').toString('base64')}`;

  let db;
  let app;
  let auth;
  let authToken;
  let userId;
  let userPublicId;

  function signPayload(payloadObj, secret = webhookSecret, id = 'msg_test_123', timestamp = '1788547000') {
    const rawPayload = typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj);
    const cleanSecret = secret.startsWith('whsec_') ? Buffer.from(secret.slice(6), 'base64') : secret;
    const toSign = `${id}.${timestamp}.${rawPayload}`;
    const sigBase64 = crypto.createHmac('sha256', cleanSecret).update(toSign).digest('base64');
    return {
      rawPayload,
      headers: {
        'content-type': 'application/json',
        'webhook-id': id,
        'webhook-timestamp': timestamp,
        'webhook-signature': `v1,${sigBase64}`,
      },
    };
  }

  beforeAll(async () => {
    process.env.POLAR_WEBHOOK_SECRET = webhookSecret;
    process.env.POLAR_CHECKOUT_URL = 'https://buy.polar.sh/polar_cl_test_checkout';
    process.env.POLAR_ORG_SLUG = 'webspresso-test';
    delete process.env.POLAR_ACCESS_TOKEN;

    clearRegistry();

    db = createDatabase({
      client: 'better-sqlite3',
      connection: ':memory:',
      models: './tests/fixtures/models-empty',
    });

    await db.knex.schema.createTable('users', (table) => {
      table.bigIncrements('id').primary();
      table.string('public_id', 64).unique();
      table.string('email', 255).unique().notNullable();
      table.string('password', 255).notNullable();
      table.string('tier', 32).notNullable().defaultTo('free');
      table.string('polar_customer_id', 128).nullable();
      table.string('polar_subscription_id', 128).nullable();
      table.string('polar_status', 32).notNullable().defaultTo('none');
      table.string('polar_current_period_end', 64).nullable();
      table.boolean('polar_cancel_at_period_end').notNullable().defaultTo(false);
      table.timestamp('created_at');
      table.timestamp('updated_at');
    });

    const UserModel = defineModel({
      name: 'User',
      table: 'users',
      schema: zdb.schema({
        id: zdb.id(),
        public_id: zdb.string({ maxLength: 64, nullable: true }),
        email: zdb.string({ maxLength: 255 }),
        password: zdb.string({ maxLength: 255 }),
        tier: zdb.string({ default: 'free' }),
        polar_customer_id: zdb.string({ maxLength: 128, nullable: true }),
        polar_subscription_id: zdb.string({ maxLength: 128, nullable: true }),
        polar_status: zdb.string({ default: 'none' }),
        polar_current_period_end: zdb.string({ maxLength: 64, nullable: true }),
        polar_cancel_at_period_end: zdb.boolean({ default: false }),
        created_at: zdb.timestamp({ auto: 'create' }),
        updated_at: zdb.timestamp({ auto: 'update' }),
      }),
      scopes: { timestamps: true },
    });
    db.registerModel(UserModel);

    auth = quickAuth({
      db,
      userModel: 'User',
      session: { secret: 'polar-plugin-test-secret' },
      rememberMe: false,
      jwt: { secret: 'polar-plugin-jwt-secret', expiresIn: '1h' },
    });

    const testEmail = `polar_${Date.now()}@example.com`;
    const UserRepo = db.getRepository('User');
    const user = await UserRepo.create({
      email: testEmail,
      password: await hash('Password123!'),
      public_id: `pub_${Date.now()}`,
      tier: 'free',
    });
    userId = user.id;
    userPublicId = user.public_id;
    authToken = auth.generateUserToken(user);

    ({ app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      db,
      auth,
      plugins: [
        polarPlugin({
          db,
          userModel: 'User',
          plans: { pro_monthly: 'prod_test' },
          tierMapping: { pro: ['pro_monthly'], free: [] },
          rateLimit: false,
        }),
      ],
    }));
  });

  afterAll(async () => {
    if (db) await db.destroy();
    clearRegistry();
    delete process.env.POLAR_WEBHOOK_SECRET;
    delete process.env.POLAR_CHECKOUT_URL;
    delete process.env.POLAR_ORG_SLUG;
  });

  describe('Webhook HMAC verification', () => {
    it('verifies standard Polar webhook signatures', () => {
      const polar = polarPlugin({ db });
      const payload = JSON.stringify({ type: 'test.event', data: {} });
      const { headers } = signPayload(payload);
      expect(polar.api.verifyPolarWebhook(payload, headers, webhookSecret)).toBe(true);
    });

    it('rejects invalid signatures', async () => {
      await request(app)
        .post('/api/v1/polar/webhook')
        .send({ type: 'subscription.created' })
        .expect(401);

      await request(app)
        .post('/api/v1/polar/webhook')
        .set('webhook-signature', 'v1,invalidsignature')
        .send({ type: 'subscription.created' })
        .expect(401);
    });
  });

  describe('Webhook tier lifecycle', () => {
    it('handles customer.state_changed pro and free transitions', async () => {
      const proPayload = {
        type: 'customer.state_changed',
        data: {
          id: 'cust_state_12345',
          external_id: userPublicId,
          email: 'x@example.com',
          active_subscriptions: [{
            id: 'sub_state_12345',
            status: 'active',
            product_id: 'prod_test',
            current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
            cancel_at_period_end: false,
          }],
        },
      };

      const signed = signPayload(proPayload);
      const res = await request(app)
        .post('/api/v1/polar/webhook')
        .set(signed.headers)
        .send(signed.rawPayload)
        .expect(200);

      expect(res.body.action).toBe('customer_state_pro');

      const statusRes = await request(app)
        .get('/api/v1/billing/status')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(statusRes.body.tier).toBe('pro');
      expect(statusRes.body.isPro).toBe(true);

      const freePayload = {
        type: 'customer.state_changed',
        data: {
          id: 'cust_state_12345',
          external_id: userPublicId,
          active_subscriptions: [],
        },
      };
      const signedFree = signPayload(freePayload);
      await request(app)
        .post('/api/v1/polar/webhook')
        .set(signedFree.headers)
        .send(signedFree.rawPayload)
        .expect(200);
    });

    it('handles subscription.created via external_id', async () => {
      const eventPayload = {
        type: 'subscription.created',
        data: {
          id: 'sub_ext_12345',
          customer_id: 'cust_ext_67890',
          status: 'active',
          current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
          customer: { external_id: userPublicId, email: 'x@example.com' },
        },
      };

      const signed = signPayload(eventPayload);
      const res = await request(app)
        .post('/api/v1/polar/webhook')
        .set(signed.headers)
        .send(signed.rawPayload)
        .expect(200);

      expect(res.body.action).toBe('subscription_activated');

      const statusRes = await request(app)
        .get('/api/v1/billing/status')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(statusRes.body.tier).toBe('pro');
    });

    it('handles subscription.created via metadata.user_id', async () => {
      await db.knex('users').where('id', userId).update({ tier: 'free', polar_status: 'none' });

      const eventPayload = {
        type: 'subscription.created',
        data: {
          id: 'sub_meta_12345',
          customer_id: 'cust_meta_67890',
          status: 'active',
          metadata: { user_id: String(userId), public_id: userPublicId },
        },
      };

      const signed = signPayload(eventPayload);
      await request(app)
        .post('/api/v1/polar/webhook')
        .set(signed.headers)
        .send(signed.rawPayload)
        .expect(200);

      const statusRes = await request(app)
        .get('/api/v1/billing/status')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(statusRes.body.tier).toBe('pro');
      expect(statusRes.body.polarStatus).toBe('active');
    });

    it('handles subscription.revoked and downgrades to free', async () => {
      const revokePayload = {
        type: 'subscription.revoked',
        data: {
          id: 'sub_meta_12345',
          customer_id: 'cust_meta_67890',
          status: 'canceled',
          metadata: { user_id: String(userId) },
        },
      };

      const signed = signPayload(revokePayload);
      const res = await request(app)
        .post('/api/v1/polar/webhook')
        .set(signed.headers)
        .send(signed.rawPayload)
        .expect(200);

      expect(res.body.action).toBe('downgraded_to_free');

      const statusRes = await request(app)
        .get('/api/v1/billing/status')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(statusRes.body.tier).toBe('free');
      expect(statusRes.body.isPro).toBe(false);
    });
  });

  describe('Checkout and portal routes', () => {
    it('POST checkout requires authentication', async () => {
      await request(app)
        .post('/settings/billing/checkout')
        .set('Accept', 'application/json')
        .expect(401);
    });

    it('POST checkout returns polar URL for authenticated user', async () => {
      const res = await request(app)
        .post('/settings/billing/checkout')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Accept', 'application/json')
        .expect(200);

      expect(res.body.url).toContain('polar');
      expect(decodeURIComponent(res.body.url)).toContain(String(userId));
    });

    it('GET checkout redirects authenticated user', async () => {
      const res = await request(app)
        .get('/settings/billing/checkout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(302);

      expect(res.header.location).toContain('polar');
    });

    it('GET checkout redirects when user already has Pro tier', async () => {
      const upgradePayload = {
        type: 'subscription.created',
        data: {
          id: 'sub_already_pro',
          status: 'active',
          metadata: { user_id: String(userId) },
        },
      };
      const signed = signPayload(upgradePayload);
      await request(app)
        .post('/api/v1/polar/webhook')
        .set(signed.headers)
        .send(signed.rawPayload)
        .expect(200);

      const res = await request(app)
        .get('/settings/billing/checkout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(302);

      expect(res.header.location).toContain('success=already_pro');

      const revokePayload = {
        type: 'subscription.revoked',
        data: { id: 'sub_already_pro', metadata: { user_id: String(userId) } },
      };
      const signedRevoke = signPayload(revokePayload);
      await request(app)
        .post('/api/v1/polar/webhook')
        .set(signedRevoke.headers)
        .send(signedRevoke.rawPayload)
        .expect(200);
    });

    it('GET portal redirects to valid polar.sh portal URL', async () => {
      const res = await request(app)
        .get('/settings/billing/portal')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(302);

      expect(res.header.location).toContain('polar.sh');
      expect(res.header.location).not.toContain('/404');
    });
  });
});

'use strict';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';

const { getPolarApiBase, polarApiRequest } = require('../../../plugins/polar/src/api');
const {
  getPolarCheckoutUrl,
  createCheckoutSessionViaApi,
  resolveHostedCheckoutBaseUrl,
  buildHostedCheckoutUrl,
  resolvePlanProductId,
} = require('../../../plugins/polar/src/checkout');
const { getPolarPortalUrl, getDefaultPortalUrl } = require('../../../plugins/polar/src/portal');
const { syncPolarBillingForUser, syncFromCustomerState, applyPolarProSubscription } = require('../../../plugins/polar/src/sync');
const {
  verifyPolarWebhook,
  handlePolarWebhookEvent,
  createWebhookRawBodyMiddleware,
} = require('../../../plugins/polar/src/webhooks');
const { polarSyncMiddleware } = require('../../../plugins/polar/src/middleware');
const { generatePolarMigration } = require('../../../plugins/polar/src/migration');
const { parsePolarEnv } = require('../../../plugins/polar/src/env.schema');
const { resolvePolarConfig } = require('../../../plugins/polar/src/config');

function baseConfig(overrides = {}) {
  return resolvePolarConfig({
    db: { knex: null },
    plans: { pro_monthly: 'prod-uuid-1', pro_yearly: 'prod-yearly' },
    tierMapping: { pro: ['pro_monthly'], free: [] },
    accessToken: 'polar_oat_test',
    orgSlug: 'test-org',
    ...overrides,
  });
}

function mockKnex(user, { table = 'users' } = {}) {
  const row = { ...user };
  const chain = {
    where: vi.fn(function where() { return chain; }),
    update: vi.fn(async (patch) => {
      Object.assign(row, patch);
      return 1;
    }),
    first: vi.fn(async () => ({ ...row })),
  };
  const knex = vi.fn((name) => {
    if (name !== table) throw new Error(`unexpected table ${name}`);
    return chain;
  });
  knex._chain = chain;
  knex._row = row;
  return knex;
}

function mockFetch(response) {
  return vi.fn(async () => ({
    ok: response.ok !== false,
    status: response.status || (response.ok === false ? 400 : 200),
    text: async () => (typeof response.body === 'string' ? response.body : JSON.stringify(response.body ?? {})),
  }));
}

describe('polar core modules', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch({ body: {} }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('api.js', () => {
    it('getPolarApiBase switches sandbox host', () => {
      expect(getPolarApiBase(false)).toContain('api.polar.sh');
      expect(getPolarApiBase(true)).toContain('sandbox-api.polar.sh');
    });

    it('polarApiRequest throws without token', async () => {
      await expect(polarApiRequest('/x', {})).rejects.toThrow('POLAR_ACCESS_TOKEN');
    });

    it('polarApiRequest parses JSON and errors', async () => {
      vi.stubGlobal('fetch', mockFetch({
        ok: false,
        status: 422,
        body: { detail: 'validation failed' },
      }));
      await expect(polarApiRequest('/checkouts/', {
        accessToken: 'tok',
        method: 'POST',
        body: { products: ['p'] },
      })).rejects.toThrow('Polar API 422');

      vi.stubGlobal('fetch', mockFetch({ body: { ok: true } }));
      const data = await polarApiRequest('customers/1/state', { accessToken: 'tok' });
      expect(data.ok).toBe(true);
    });

    it('polarApiRequest handles non-JSON body', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => 'plain-text',
      })));
      const data = await polarApiRequest('/x', { accessToken: 'tok' });
      expect(data.raw).toBe('plain-text');
    });
  });

  describe('checkout.js', () => {
    const user = { id: 7, public_id: 'pub_7', email: 'u@test.com' };

    it('resolvePlanProductId yearly fallback', () => {
      const cfg = baseConfig({ plans: { pro_monthly: 'm', pro_yearly: 'y' } });
      expect(resolvePlanProductId('pro_yearly', cfg)).toBe('y');
      expect(resolvePlanProductId('pro_monthly', cfg)).toBe('m');
    });

    it('createCheckoutSessionViaApi returns client_secret checkout URL', async () => {
      vi.stubGlobal('fetch', mockFetch({
        body: { client_secret: 'polar_cst_abc' },
      }));
      const cfg = baseConfig({ priceId: 'price_1' });
      const url = await createCheckoutSessionViaApi({
        user,
        productId: 'prod-uuid-1',
        baseUrl: 'https://example.com',
        config: cfg,
      });
      expect(url).toContain('polar.sh/checkout/polar_cst_abc');
    });

    it('getPolarCheckoutUrl falls back to hosted checkout URL', async () => {
      const cfg = baseConfig({
        accessToken: null,
        checkoutUrl: 'https://buy.polar.sh/polar_cl_hosted',
      });
      const url = await getPolarCheckoutUrl({
        user,
        baseUrl: 'https://example.com',
        config: cfg,
      });
      expect(url).toContain('metadata%5Buser_id%5D=7');
      expect(url).toContain('polar_cl_hosted');
    });

    it('resolveHostedCheckoutBaseUrl builds from polar_cl product id', () => {
      const cfg = baseConfig({
        checkoutUrl: null,
        plans: { pro_monthly: 'polar_cl_inline' },
      });
      expect(resolveHostedCheckoutBaseUrl(cfg)).toContain('polar_cl_inline');
      expect(buildHostedCheckoutUrl('https://buy.polar.sh/x', user, cfg)).toContain('email=');
    });

    it('getPolarCheckoutUrl throws when not configured', async () => {
      const cfg = baseConfig({ accessToken: null, checkoutUrl: null, plans: {} });
      await expect(getPolarCheckoutUrl({ user, baseUrl: 'https://x.com', config: cfg }))
        .rejects.toThrow('not configured');
    });

    it('getPolarCheckoutUrl falls back to hosted when API checkout fails', async () => {
      vi.stubGlobal('fetch', mockFetch({ ok: false, status: 500, body: { error: 'down' } }));
      const cfg = baseConfig({
        checkoutUrl: 'https://buy.polar.sh/polar_cl_fallback',
      });
      const url = await getPolarCheckoutUrl({
        user,
        baseUrl: 'https://example.com',
        config: cfg,
      });
      expect(url).toContain('polar_cl_fallback');
    });

    it('createCheckoutSessionViaApi uses absolute success and return URLs', async () => {
      vi.stubGlobal('fetch', mockFetch({
        body: { url: 'https://polar.sh/checkout/polar_cst_abs' },
      }));
      const cfg = baseConfig({
        urls: {
          success: 'https://example.com/success',
          return: 'https://example.com/return',
          alreadySubscribed: '/billing',
          login: '/login',
        },
      });
      const url = await createCheckoutSessionViaApi({
        user,
        productId: 'prod-uuid-1',
        baseUrl: 'https://ignored.example.com',
        config: cfg,
      });
      expect(url).toContain('polar_cst_abs');
    });
  });

  describe('portal.js', () => {
    it('getDefaultPortalUrl respects sandbox', () => {
      expect(getDefaultPortalUrl(baseConfig({ orgSlug: 'acme', sandbox: true })))
        .toBe('https://sandbox.polar.sh/acme/portal');
    });

    it('getPolarPortalUrl uses API session when available', async () => {
      vi.stubGlobal('fetch', mockFetch({
        body: { customer_portal_url: 'https://polar.sh/test-org/portal/session' },
      }));
      const cfg = baseConfig();
      const url = await getPolarPortalUrl(
        { polar_customer_id: 'cust_1' },
        'https://example.com',
        cfg
      );
      expect(url).toContain('/portal');
    });

    it('getPolarPortalUrl falls back to org slug portal', async () => {
      vi.stubGlobal('fetch', mockFetch({ ok: false, status: 500, body: { error: 'fail' } }));
      const url = await getPolarPortalUrl({}, 'https://example.com', baseConfig());
      expect(url).toBe('https://polar.sh/test-org/portal');
    });
  });

  describe('sync.js', () => {
    it('syncPolarBillingForUser returns early without token', async () => {
      const user = { id: 1, tier: 'free' };
      const out = await syncPolarBillingForUser(user, mockKnex(user), baseConfig({ accessToken: null }));
      expect(out).toEqual(user);
    });

    it('syncPolarBillingForUser upgrades via external customer state', async () => {
      vi.stubGlobal('fetch', mockFetch({
        body: {
          id: 'cust_1',
          active_subscriptions: [{
            id: 'sub_1',
            status: 'active',
            product_id: 'prod-uuid-1',
            current_period_end: new Date(Date.now() + 86400000).toISOString(),
          }],
        },
      }));
      const knex = mockKnex({ id: 1, tier: 'free', public_id: 'pub_1' });
      const cfg = baseConfig();
      const out = await syncPolarBillingForUser(knex._row, knex, cfg);
      expect(out.tier).toBe('pro');
    });

    it('applyPolarProSubscription uses onSubscriptionChange hook', async () => {
      const hook = vi.fn();
      const knex = mockKnex({ id: 2, tier: 'free' });
      const cfg = baseConfig({ hooks: { onSubscriptionChange: hook } });
      await applyPolarProSubscription(
        knex,
        knex._row,
        { id: 'cust_2' },
        { id: 'sub_2', status: 'active' },
        cfg
      );
      expect(hook).toHaveBeenCalled();
    });

    it('syncFromCustomerState patches polar_customer_id only', async () => {
      const knex = mockKnex({ id: 3, tier: 'free', polar_customer_id: null });
      const cfg = baseConfig();
      const out = await syncFromCustomerState(knex._row, knex, { id: 'cust_new' }, cfg);
      expect(out.polar_customer_id).toBe('cust_new');
    });

    it('syncPolarBillingForUser walks email and subscription fallbacks', async () => {
      const fetchMock = vi.fn()
        .mockRejectedValueOnce(new Error('Polar API 404: missing'))
        .mockRejectedValueOnce(new Error('Polar API 404: missing'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ items: [{ id: 'cust_email' }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ active_subscriptions: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            items: [{
              id: 'sub_ext',
              status: 'active',
              product_id: 'prod-uuid-1',
              customer_id: 'cust_ext',
            }],
          }),
        });
      vi.stubGlobal('fetch', fetchMock);

      const knex = mockKnex({
        id: 5,
        tier: 'free',
        email: 'sync@test.com',
        polar_customer_id: 'cust_existing',
      });
      const out = await syncPolarBillingForUser(knex._row, knex, baseConfig());
      expect(out.tier).toBe('pro');
    });

    it('syncPolarBillingForUser logs non-404 external state errors', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new Error('Polar API 500: boom');
      }));
      const knex = mockKnex({ id: 6, tier: 'free', public_id: 'pub_6' });
      await syncPolarBillingForUser(knex._row, knex, baseConfig());
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });

  describe('webhooks.js', () => {
    it('verifyPolarWebhook rejects missing secret and signature', () => {
      expect(verifyPolarWebhook('{}', {}, null)).toBe(false);
      expect(verifyPolarWebhook('{}', {}, 'secret')).toBe(false);
    });

    it('verifyPolarWebhook accepts valid standard signature', () => {
      const secret = `whsec_${Buffer.from('test-secret-key-1234567890').toString('base64')}`;
      const payload = '{"type":"test"}';
      const id = 'msg_1';
      const ts = '1700000000';
      const clean = Buffer.from(secret.slice(6), 'base64');
      const sig = crypto.createHmac('sha256', clean).update(`${id}.${ts}.${payload}`).digest('base64');
      expect(verifyPolarWebhook(payload, {
        'webhook-id': id,
        'webhook-timestamp': ts,
        'webhook-signature': `v1,${sig}`,
      }, secret)).toBe(true);
    });

    it('handlePolarWebhookEvent covers subscription pending and order paths', async () => {
      const knex = mockKnex({ id: 9, tier: 'free' });
      const cfg = baseConfig();

      const pending = await handlePolarWebhookEvent({
        type: 'subscription.created',
        data: {
          id: 'sub_p',
          status: 'incomplete',
          metadata: { user_id: '9' },
        },
      }, knex, cfg);
      expect(pending.action).toBe('subscription_pending');

      vi.stubGlobal('fetch', mockFetch({
        body: {
          active_subscriptions: [{
            id: 'sub_o',
            status: 'active',
            product_id: 'prod-uuid-1',
          }],
        },
      }));

      const order = await handlePolarWebhookEvent({
        type: 'order.paid',
        data: { metadata: { user_id: '9' }, customer_id: 'cust_o' },
      }, knex, cfg);
      expect(['order_completed', 'checkout_recorded']).toContain(order.action);
    });

    it('handlePolarWebhookEvent cancel pending vs immediate revoke', async () => {
      const knex = mockKnex({
        id: 10,
        tier: 'pro',
        polar_current_period_end: new Date(Date.now() + 86400000).toISOString(),
      });
      const cfg = baseConfig();

      const pendingCancel = await handlePolarWebhookEvent({
        type: 'subscription.canceled',
        data: {
          metadata: { user_id: '10' },
          current_period_end: knex._row.polar_current_period_end,
        },
      }, knex, cfg);
      expect(pendingCancel.action).toBe('marked_cancel_pending');

      const revoke = await handlePolarWebhookEvent({
        type: 'subscription.revoked',
        data: { metadata: { user_id: '10' } },
      }, knex, cfg);
      expect(revoke.action).toBe('downgraded_to_free');
    });

    it('handlePolarWebhookEvent returns invalid and ignored actions', async () => {
      const knex = mockKnex({ id: 11, tier: 'free' });
      const cfg = baseConfig();
      expect(await handlePolarWebhookEvent(null, knex, cfg)).toMatchObject({ action: 'invalid_event' });
      expect(await handlePolarWebhookEvent({
        type: 'unknown.event',
        data: { metadata: { user_id: '11' } },
      }, knex, cfg)).toMatchObject({ action: 'ignored_event_type' });
      const emptyKnex = vi.fn(() => ({
        where: vi.fn(function where() { return this; }),
        first: vi.fn(async () => null),
      }));
      expect(await handlePolarWebhookEvent({
        type: 'subscription.created',
        data: { metadata: { user_id: '99999' } },
      }, emptyKnex, cfg)).toMatchObject({ action: 'user_not_found' });
    });

    it('createWebhookRawBodyMiddleware captures raw body', async () => {
      const mw = createWebhookRawBodyMiddleware('/hook');
      const req = new EventEmitter();
      req.path = '/hook';
      const next = vi.fn();
      mw(req, {}, next);
      req.emit('data', Buffer.from('{"a":1}'));
      req.emit('end');
      expect(req.rawBody.toString()).toBe('{"a":1}');
      expect(next).toHaveBeenCalled();
    });

    it('createWebhookRawBodyMiddleware skips unrelated paths', () => {
      const mw = createWebhookRawBodyMiddleware('/hook');
      const req = { path: '/other' };
      const next = vi.fn();
      mw(req, {}, next);
      expect(next).toHaveBeenCalled();
      expect(req.rawBody).toBeUndefined();
    });
  });

  describe('middleware & migration & env', () => {
    it('polarSyncMiddleware syncs user when predicate matches', async () => {
      vi.stubGlobal('fetch', mockFetch({ body: { active_subscriptions: [] } }));
      const knex = mockKnex({ id: 4, tier: 'free', public_id: 'p4' });
      const cfg = baseConfig({ db: { knex } });
      const mw = polarSyncMiddleware(cfg, { when: () => true });
      const req = { user: { id: 4 }, query: {} };
      const next = vi.fn();
      await mw(req, {}, next);
      expect(next).toHaveBeenCalled();
    });

    it('polarSyncMiddleware skips without user', async () => {
      const mw = polarSyncMiddleware(baseConfig(), { when: () => true });
      const next = vi.fn();
      await mw({ query: {} }, {}, next);
      expect(next).toHaveBeenCalled();
    });

    it('polarSyncMiddleware continues on sync errors', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const knex = vi.fn(() => { throw new Error('db down'); });
      const cfg = baseConfig({ db: { knex } });
      const mw = polarSyncMiddleware(cfg, { when: () => true });
      const next = vi.fn();
      await mw({ user: { id: 1 } }, {}, next);
      expect(next).toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it('generatePolarMigration includes table and columns', () => {
      const sql = generatePolarMigration({ tableName: 'accounts' });
      expect(sql).toContain('accounts');
      expect(sql).toContain('polar_customer_id');
    });

    it('parsePolarEnv validates URLs', () => {
      expect(parsePolarEnv({ POLAR_SANDBOX: 'true' }).POLAR_SANDBOX).toBe(true);
      expect(() => parsePolarEnv({ POLAR_CHECKOUT_URL: 'not-a-url' })).toThrow('Invalid Polar env');
    });
  });
});

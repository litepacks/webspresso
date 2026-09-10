'use strict';

const { verifyPolarWebhook, handlePolarWebhookEvent } = require('./webhooks');
const { getPolarCheckoutUrl } = require('./checkout');
const { getPolarPortalUrl } = require('./portal');
const { syncPolarBillingForUser } = require('./sync');
const { userHasProTier } = require('./user-resolver');
const { userIsPaid } = require('./billing-hooks');

function resolveKnex(db) {
  return db?.knex || (typeof db?.raw === 'function' ? db : null);
}

function wantsJson(req) {
  return req.xhr
    || req.headers.accept?.includes('application/json')
    || req.is('json');
}

function resolveBaseUrl(req, config) {
  return config.baseUrl || `${req.protocol}://${req.get('host')}`;
}

function createInjectDb(db) {
  return (req, res, next) => {
    if (db && !req.db) req.db = db;
    next();
  };
}

function createWebhookHandler(config) {
  return async function polarWebhookHandler(req, res) {
    try {
      const secret = config.webhookSecret;
      if (!secret) {
        return res.status(500).json({ error: 'POLAR_WEBHOOK_SECRET is not configured' });
      }

      const rawPayload = req.rawBody
        ? (Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : String(req.rawBody))
        : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

      if (!verifyPolarWebhook(rawPayload, req.headers, secret)) {
        return res.status(401).json({ error: 'Invalid webhook signature', received: false });
      }

      const knex = resolveKnex(config.db);
      if (!knex) {
        return res.status(500).json({ error: 'Database unavailable' });
      }

      const event = typeof req.body === 'object' && req.body && !Buffer.isBuffer(req.body)
        ? req.body
        : JSON.parse(rawPayload);

      const result = await handlePolarWebhookEvent(event, knex, config);
      return res.status(200).json({
        received: true,
        processed: result.processed,
        action: result.action,
        userId: result.userId,
      });
    } catch (err) {
      console.error('[polar] Webhook error:', err);
      return res.status(400).json({ error: err.message || 'Webhook processing failed' });
    }
  };
}

function createCheckoutHandler(config) {
  return async function polarCheckoutHandler(req, res) {
    try {
      if (!req.user) {
        if (wantsJson(req)) return res.status(401).json({ error: 'Authentication required' });
        return res.redirect(config.urls.login);
      }

      const knex = resolveKnex(config.db);
      const f = config.fields;
      let user = req.user;

      if (knex) {
        const dbUser = await knex(config.userTable).where(f.id, req.user[f.id] || req.user.id).first();
        if (dbUser) user = dbUser;
        if (config.accessToken && config.syncBeforeCheckout) {
          user = await syncPolarBillingForUser(user, knex, config);
        }
      }

      if (await userIsPaid(user, knex, config)) {
        const alreadyUrl = config.urls.alreadySubscribed.startsWith('http')
          ? config.urls.alreadySubscribed
          : config.urls.alreadySubscribed;
        if (wantsJson(req)) {
          return res.status(409).json({
            error: 'You already have an active subscription.',
            tier: user[f.tier],
            polarStatus: user[f.polarStatus] || 'active',
          });
        }
        return res.redirect(alreadyUrl);
      }

      const plan = req.body?.plan || req.query?.plan || 'pro_monthly';
      const baseUrl = resolveBaseUrl(req, config);
      const checkoutUrl = await getPolarCheckoutUrl({ user, plan, baseUrl, config });

      if (wantsJson(req)) {
        return res.json({ url: checkoutUrl });
      }
      return res.redirect(checkoutUrl);
    } catch (err) {
      console.error('[polar] Checkout error:', err.message);
      if (wantsJson(req)) {
        return res.status(503).json({ error: 'Checkout is temporarily unavailable. Please try again later.' });
      }
      const errUrl = config.urls.return.includes('?')
        ? `${config.urls.return}&error=checkout_unavailable`
        : `${config.urls.return}?error=checkout_unavailable`;
      return res.redirect(errUrl);
    }
  };
}

function createPortalHandler(config) {
  return async function polarPortalHandler(req, res) {
    try {
      if (!req.user) {
        return res.redirect(config.urls.login);
      }

      const baseUrl = resolveBaseUrl(req, config);
      const portalUrl = await getPolarPortalUrl(req.user, baseUrl, config);
      return res.redirect(portalUrl);
    } catch (err) {
      console.error('[polar] Portal error:', err.message);
      const errUrl = config.urls.return.includes('?')
        ? `${config.urls.return}&error=portal_unavailable`
        : `${config.urls.return}?error=portal_unavailable`;
      return res.redirect(errUrl);
    }
  };
}

function createStatusHandler(config) {
  return async function polarStatusHandler(req, res, next) {
    try {
      const knex = resolveKnex(config.db);
      const f = config.fields;
      let user = req.user;

      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (knex) {
        const dbUser = await knex(config.userTable).where(f.id, user[f.id] || user.id).first();
        if (dbUser) user = dbUser;
        if (config.accessToken) {
          user = await syncPolarBillingForUser(user, knex, config);
        }
      }

      const tier = user[f.tier] || config.freeTierName;
      const isPro = userHasProTier(user, config);

      return res.json({
        userId: user[f.id],
        publicId: user[f.publicId],
        tier,
        isPro,
        polarStatus: user[f.polarStatus] || 'none',
        polarCustomerId: user[f.polarCustomerId] || null,
        polarSubscriptionId: user[f.polarSubscriptionId] || null,
        polarCurrentPeriodEnd: user[f.polarCurrentPeriodEnd] || null,
        polarCancelAtPeriodEnd: Boolean(user[f.polarCancelAtPeriodEnd]),
      });
    } catch (err) {
      next(err);
    }
  };
}

function createRequireAuth(config, ctx) {
  if (typeof config.requireAuth === 'function') {
    return config.requireAuth;
  }

  const authFactory = ctx.middlewares?.auth;
  if (typeof authFactory === 'function') {
    return (req, res, next) => {
      const isApi = req.path.startsWith('/api/') || wantsJson(req);
      return authFactory({ api: isApi })(req, res, next);
    };
  }

  return (req, res, next) => {
    if (req.user) return next();
    if (wantsJson(req) || req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.redirect(config.urls.login);
  };
}

module.exports = {
  createInjectDb,
  createWebhookHandler,
  createCheckoutHandler,
  createPortalHandler,
  createStatusHandler,
  createRequireAuth,
};

'use strict';

/**
 * Polar.sh billing plugin for Webspresso
 * @module plugins/polar
 */

const { resolvePolarConfig } = require('./src/config');
const { polarEnvSchema, parsePolarEnv } = require('./src/env.schema');
const { polarApiRequest } = require('./src/api');
const { verifyPolarWebhook, handlePolarWebhookEvent, createWebhookRawBodyMiddleware } = require('./src/webhooks');
const { getPolarCheckoutUrl } = require('./src/checkout');
const { getPolarPortalUrl } = require('./src/portal');
const { syncPolarBillingForUser } = require('./src/sync');
const { syncBillingForAppUser } = require('./src/billing-hooks');
const {
  resolveUserFromPolarData,
  buildCheckoutMetadata,
  isProSubscriptionStatus,
  userHasProTier,
  pickBestActiveSubscription,
} = require('./src/user-resolver');
const {
  isValidCheckoutRedirectUrl,
  isValidPortalRedirectUrl,
  extractCheckoutUrlFromResponse,
  polarCspDirectives,
  mergePolarCspDirectives,
} = require('./src/urls');
const { generatePolarMigration } = require('./src/migration');
const { polarSyncMiddleware } = require('./src/middleware');
const { registerNunjucksFilters, dateLabel } = require('./src/nunjucks-filters');
const {
  createInjectDb,
  createWebhookHandler,
  createCheckoutHandler,
  createPortalHandler,
  createStatusHandler,
  createRequireAuth,
} = require('./src/routes');
const { resolvePolarRateLimiters, DEFAULT_RATE_LIMITS } = require('./src/rate-limit');

/**
 * @param {Object} options
 * @param {import('../../core/orm/database').Database} options.db
 * @param {string} [options.userModel='User']
 * @param {string} [options.userTable='users']
 * @param {Record<string, string>} [options.plans]
 * @param {Record<string, string[]>} [options.tierMapping]
 * @param {Object} [options.routes]
 * @param {Object} [options.urls]
 * @param {Object} [options.fields]
 * @param {Object} [options.hooks]
 * @param {Function} [options.requireAuth]
 * @param {boolean} [options.enabled=true]
 */
function polarPlugin(options = {}) {
  const config = resolvePolarConfig(options);
  let runtimeConfig = config;

  const sdk = {
    verifyPolarWebhook,
    polarApiRequest: (path, opts = {}) => polarApiRequest(path, {
      ...opts,
      accessToken: opts.accessToken || runtimeConfig.accessToken,
      sandbox: opts.sandbox !== undefined ? opts.sandbox : runtimeConfig.sandbox,
    }),
    getPolarCheckoutUrl: (params) => getPolarCheckoutUrl({ ...params, config: runtimeConfig }),
    getPolarPortalUrl: (user, baseUrl) => getPolarPortalUrl(user, baseUrl, runtimeConfig),
    syncPolarBillingForUser: (user, knex) => syncPolarBillingForUser(user, knex, runtimeConfig),
    /** Dashboard/page-load sync — optional per-call hooks override */
    syncBillingForAppUser: (user, knex, opts) => syncBillingForAppUser(user, knex, runtimeConfig, opts),
    handlePolarWebhookEvent: (event, knex, hooks) => handlePolarWebhookEvent(event, knex, runtimeConfig, hooks),
    resolveUserFromPolarData: (data, knex) => resolveUserFromPolarData(data, knex, runtimeConfig),
    extractCheckoutUrlFromResponse: (data) => extractCheckoutUrlFromResponse(data, runtimeConfig.sandbox),
    isValidCheckoutRedirectUrl,
    isValidPortalRedirectUrl,
    buildCheckoutMetadata: (user, customFields) => buildCheckoutMetadata(user, runtimeConfig, customFields),
    userHasProTier: (user) => userHasProTier(user, runtimeConfig),
    isProSubscriptionStatus,
    pickBestActiveSubscription: (subs) => pickBestActiveSubscription(subs, runtimeConfig),
    generateMigration: (opts) => generatePolarMigration({ ...opts, fields: runtimeConfig.fields }),
    polarSyncMiddleware: (opts) => polarSyncMiddleware(runtimeConfig, opts),
    polarCspDirectives,
    mergePolarCspDirectives,
    createWebhookRawBodyMiddleware,
    registerNunjucksFilters,
    dateLabel,
    parseEnv: parsePolarEnv,
    envSchema: polarEnvSchema,
    getConfig: () => ({ ...runtimeConfig }),
    defaultRateLimits: DEFAULT_RATE_LIMITS,
  };

  return {
    name: 'polar',
    version: '1.0.1',
    description: 'Polar.sh subscription billing — checkout, portal, webhooks, and tier sync',

    csp: polarCspDirectives(),

    api: sdk,

    register(ctx) {
      runtimeConfig = resolvePolarConfig({ ...options, db: options.db || ctx.db });
      if (!runtimeConfig.enabled) return;

      registerNunjucksFilters(ctx.nunjucksEnv);

      if (runtimeConfig.syncMiddleware) {
        ctx.app.use(polarSyncMiddleware(runtimeConfig));
      }
    },

    onRoutesReady(ctx) {
      runtimeConfig = resolvePolarConfig({ ...options, db: options.db || ctx.db });
      if (!runtimeConfig.enabled) return;

      const db = runtimeConfig.db || ctx.db;
      if (!db) {
        console.warn('[polar] Skipping routes: no database (pass options.db or createApp({ db }))');
        return;
      }

      const injectDb = createInjectDb(db);
      const requireAuth = createRequireAuth(runtimeConfig, ctx);
      const { routes } = runtimeConfig;
      const rl = resolvePolarRateLimiters(ctx, runtimeConfig);

      const chain = (...handlers) => handlers.filter(Boolean);

      ctx.addRoute('post', routes.webhook, ...chain(injectDb, rl.webhook, createWebhookHandler(runtimeConfig)));
      ctx.addRoute('post', routes.checkout, ...chain(injectDb, requireAuth, rl.checkout, createCheckoutHandler(runtimeConfig)));
      ctx.addRoute('get', routes.checkout, ...chain(injectDb, requireAuth, rl.checkout, createCheckoutHandler(runtimeConfig)));
      ctx.addRoute('get', routes.portal, ...chain(injectDb, requireAuth, rl.portal, createPortalHandler(runtimeConfig)));
      ctx.addRoute('get', routes.status, ...chain(injectDb, requireAuth, rl.status, createStatusHandler(runtimeConfig)));

      if (process.env.NODE_ENV !== 'production') {
        console.log(`  Polar billing: POST ${routes.webhook}`);
        console.log(`  Polar billing: GET/POST ${routes.checkout}`);
        console.log(`  Polar billing: GET ${routes.portal}`);
        console.log(`  Polar billing: GET ${routes.status}`);
      }
    },
  };
}

module.exports = polarPlugin;
module.exports.polarPlugin = polarPlugin;

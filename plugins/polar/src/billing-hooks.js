'use strict';

const { userHasProTier } = require('./user-resolver');
const { syncPolarBillingForUser } = require('./sync');

/**
 * Invoke hooks.isPaidUser — supports ({ user, knex, config }) or legacy (user, knex, config).
 * @param {Function} hook
 * @param {Object} user
 * @param {Object} knex
 * @param {import('./config').PolarConfig} config
 */
async function invokeIsPaidUserHook(hook, user, knex, config) {
  const ctx = { user, knex, config };
  // Legacy (user, knex, config) when declared with 2+ params; default is ({ user, knex, config })
  const result = hook.length >= 2
    ? await hook(user, knex, config)
    : await hook(ctx);
  return Boolean(result);
}

/**
 * Paid-user check at checkout: hooks.isPaidUser override, else users.tier via userHasProTier.
 */
async function userIsPaid(user, knex, config) {
  if (typeof config.hooks?.isPaidUser === 'function') {
    return invokeIsPaidUserHook(config.hooks.isPaidUser, user, knex, config);
  }
  return userHasProTier(user, config);
}

/**
 * App-level billing sync for dashboard loaders — merges optional hook overrides per call.
 * @param {Object} user
 * @param {Object} knex
 * @param {import('./config').PolarConfig} config
 * @param {{ hooks?: Object }} [opts]
 */
async function syncBillingForAppUser(user, knex, config, opts = {}) {
  const merged = {
    ...config,
    hooks: { ...config.hooks, ...(opts.hooks || {}) },
  };
  return syncPolarBillingForUser(user, knex, merged);
}

module.exports = {
  invokeIsPaidUserHook,
  userIsPaid,
  syncBillingForAppUser,
};

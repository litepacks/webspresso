'use strict';

const { syncPolarBillingForUser } = require('./sync');

/**
 * Optional middleware: sync billing from Polar on matching requests (webhook delay fallback).
 * @param {import('./config').PolarConfig} config
 * @param {Object} [opts]
 * @param {(req: import('express').Request) => boolean} [opts.when]
 */
function polarSyncMiddleware(config, opts = {}) {
  const when = opts.when || config.syncMiddleware?.when || (() => false);

  return async function polarSync(req, res, next) {
    try {
      if (!when(req) || !req.user) return next();

      const knex = config.db?.knex || config.db;
      if (!knex || !config.accessToken) return next();

      const f = config.fields;
      let user = req.user;
      const dbUser = await knex(config.userTable).where(f.id, req.user[f.id] || req.user.id).first();
      if (dbUser) user = dbUser;

      req.user = await syncPolarBillingForUser(user, knex, config);
      next();
    } catch (err) {
      console.error('[polar] Sync middleware error:', err.message);
      next();
    }
  };
}

module.exports = {
  polarSyncMiddleware,
};

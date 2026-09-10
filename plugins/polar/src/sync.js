'use strict';

const { polarApiRequest } = require('./api');
const {
  userHasProTier,
  listPolarSubscriptions,
  pickBestActiveSubscription,
  normalizePolarTimestamp,
  collectExternalCustomerIds,
} = require('./user-resolver');

async function applyPolarProSubscription(knex, user, customerState, subscription, config) {
  const f = config.fields;
  const update = {
    [f.tier]: config.proTierName,
    [f.polarStatus]: subscription.status || 'active',
    [f.polarCustomerId]: customerState?.id || subscription.customer_id || user[f.polarCustomerId] || null,
    [f.polarSubscriptionId]: subscription.id || user[f.polarSubscriptionId] || null,
    [f.polarCurrentPeriodEnd]: normalizePolarTimestamp(subscription.current_period_end),
    [f.polarCancelAtPeriodEnd]: Boolean(subscription.cancel_at_period_end),
    updated_at: new Date(),
  };

  if (config.hooks.onSubscriptionChange) {
    await config.hooks.onSubscriptionChange({
      user,
      tier: config.proTierName,
      polarStatus: update[f.polarStatus],
      subscription,
      knex,
      update,
    });
  } else {
    await knex(config.userTable).where(f.id, user[f.id]).update(update);
  }

  return knex(config.userTable).where(f.id, user[f.id]).first();
}

async function syncFromCustomerState(user, knex, customerState, config) {
  if (!customerState) return user;

  const activeSub = pickBestActiveSubscription(customerState.active_subscriptions, config);
  if (activeSub) {
    return applyPolarProSubscription(knex, user, customerState, activeSub, config);
  }

  const f = config.fields;
  if (customerState.id && customerState.id !== user[f.polarCustomerId]) {
    const patch = {
      [f.polarCustomerId]: customerState.id,
      updated_at: new Date(),
    };
    await knex(config.userTable).where(f.id, user[f.id]).update(patch);
    return { ...user, [f.polarCustomerId]: customerState.id };
  }

  return user;
}

async function syncPolarBillingForUser(user, knex, config) {
  if (!user || !knex || !config.accessToken) {
    return user;
  }

  const apiOpts = { accessToken: config.accessToken, sandbox: config.sandbox };
  const externalIds = collectExternalCustomerIds(user, config);

  for (const externalId of externalIds) {
    try {
      const state = await polarApiRequest(
        `/customers/external/${encodeURIComponent(externalId)}/state`,
        apiOpts
      );
      user = await syncFromCustomerState(user, knex, state, config);
      if (userHasProTier(user, config)) return user;
    } catch (err) {
      if (!String(err.message || '').includes('404')) {
        console.error('[polar] Sync error (external state):', externalId, err.message);
      }
    }
  }

  const f = config.fields;
  if (user[f.polarCustomerId]) {
    try {
      const state = await polarApiRequest(`/customers/${user[f.polarCustomerId]}/state`, apiOpts);
      user = await syncFromCustomerState(user, knex, state, config);
      if (userHasProTier(user, config)) return user;
    } catch (err) {
      if (!String(err.message || '').includes('404')) {
        console.error('[polar] Sync error (customer state):', user[f.polarCustomerId], err.message);
      }
    }
  }

  if (user[f.email]) {
    try {
      const customersData = await polarApiRequest(
        `/customers/?email=${encodeURIComponent(String(user[f.email]).trim())}&limit=5`,
        apiOpts
      );
      for (const customer of listPolarSubscriptions(customersData)) {
        if (!customer?.id) continue;
        const state = await polarApiRequest(`/customers/${customer.id}/state`, apiOpts);
        user = await syncFromCustomerState(user, knex, state, config);
        if (userHasProTier(user, config)) return user;
      }
    } catch (err) {
      console.error('[polar] Sync error (email lookup):', user[f.email], err.message);
    }
  }

  for (const externalId of externalIds) {
    try {
      const subsData = await polarApiRequest(
        `/subscriptions/?external_customer_id=${encodeURIComponent(externalId)}&limit=10`,
        apiOpts
      );
      const activeSub = pickBestActiveSubscription(listPolarSubscriptions(subsData), config);
      if (activeSub) {
        return applyPolarProSubscription(knex, user, { id: activeSub.customer_id }, activeSub, config);
      }
    } catch (err) {
      if (!String(err.message || '').includes('404')) {
        console.error('[polar] Sync error (subscriptions list):', externalId, err.message);
      }
    }
  }

  return user;
}

module.exports = {
  applyPolarProSubscription,
  syncFromCustomerState,
  syncPolarBillingForUser,
};

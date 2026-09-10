'use strict';

const crypto = require('crypto');
const { syncPolarBillingForUser, applyPolarProSubscription } = require('./sync');
const {
  collectPolarMetadata,
  isProSubscriptionStatus,
  userHasProTier,
  parsePolarTimestamp,
  pickBestActiveSubscription,
  resolveUserFromPolarData,
  extractSubscriptionFields,
} = require('./user-resolver');

function verifyPolarWebhook(rawPayload, headers, secret) {
  if (!secret) return false;

  const signatureHeader =
    headers['webhook-signature']
    || headers['polar-webhook-signature']
    || headers['x-polar-signature'];

  if (!signatureHeader) return false;

  const webhookId = headers['webhook-id'] || headers['x-webhook-id'] || '';
  const webhookTimestamp = headers['webhook-timestamp'] || headers['x-webhook-timestamp'] || '';

  const candidates = signatureHeader
    .split(/[\s,]+/)
    .map((s) => s.trim().replace(/^v1=|^v1,/, ''))
    .filter(Boolean);

  const payloadStr = typeof rawPayload === 'string' ? rawPayload : rawPayload.toString('utf8');
  const standardToSign = webhookId && webhookTimestamp ? `${webhookId}.${webhookTimestamp}.${payloadStr}` : payloadStr;

  const cleanSecret = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice(6), 'base64')
    : secret;

  const expectedBase64 = crypto.createHmac('sha256', cleanSecret).update(standardToSign).digest('base64');
  const expectedHex = crypto.createHmac('sha256', cleanSecret).update(standardToSign).digest('hex');
  const rawExpectedBase64 = crypto.createHmac('sha256', cleanSecret).update(payloadStr).digest('base64');
  const rawExpectedHex = crypto.createHmac('sha256', cleanSecret).update(payloadStr).digest('hex');

  const expectedList = [expectedBase64, expectedHex, rawExpectedBase64, rawExpectedHex];

  for (const candidate of candidates) {
    for (const exp of expectedList) {
      try {
        const a = Buffer.from(candidate);
        const b = Buffer.from(exp);
        if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
          return true;
        }
      } catch {
        // continue
      }
    }
  }

  return false;
}

async function updateUserTier(knex, user, patch, config) {
  const f = config.fields;
  if (config.hooks.onSubscriptionChange && patch.tier !== undefined) {
    await config.hooks.onSubscriptionChange({
      user,
      tier: patch.tier,
      polarStatus: patch[f.polarStatus],
      subscription: patch._subscription || null,
      knex,
      update: patch,
    });
    return knex(config.userTable).where(f.id, user[f.id]).first();
  }

  const { _subscription, ...dbPatch } = patch;
  await knex(config.userTable).where(f.id, user[f.id]).update({
    ...dbPatch,
    updated_at: new Date(),
  });
  return knex(config.userTable).where(f.id, user[f.id]).first();
}

async function handlePolarWebhookEvent(event, knex, config, hooks = {}) {
  const mergedConfig = { ...config, hooks: { ...config.hooks, ...hooks } };

  if (!event || !event.type || !knex) {
    return { processed: false, action: 'invalid_event' };
  }

  const { type, data } = event;
  const user = await resolveUserFromPolarData(data, knex, mergedConfig);

  if (!user) {
    console.warn('[polar] Webhook user_not_found', { type, metadata: collectPolarMetadata(data).metadata });
    return { processed: false, action: 'user_not_found', eventType: type };
  }

  const f = mergedConfig.fields;
  const {
    subscriptionId,
    customerId,
    status,
    periodEnd,
    cancelAtPeriodEnd,
  } = extractSubscriptionFields(data, user, mergedConfig);

  switch (type) {
    case 'subscription.created':
    case 'subscription.updated':
    case 'subscription.active':
    case 'subscription.uncanceled': {
      const isProActive = isProSubscriptionStatus(status);
      const patch = {
        [f.polarStatus]: status,
        [f.polarCustomerId]: customerId,
        [f.polarSubscriptionId]: subscriptionId,
        [f.polarCurrentPeriodEnd]: periodEnd,
        [f.polarCancelAtPeriodEnd]: cancelAtPeriodEnd,
        _subscription: data,
      };

      if (isProActive) {
        patch[f.tier] = mergedConfig.proTierName;
        patch.tier = mergedConfig.proTierName;
        await updateUserTier(knex, user, patch, mergedConfig);
        return { processed: true, action: 'subscription_activated', userId: user[f.id], tier: mergedConfig.proTierName };
      }

      patch[f.tier] = user[f.tier];
      patch.tier = user[f.tier];
      await updateUserTier(knex, user, patch, mergedConfig);

      const syncedUser = await syncPolarBillingForUser(user, knex, mergedConfig);
      return {
        processed: true,
        action: userHasProTier(syncedUser, mergedConfig) ? 'subscription_synced_to_pro' : 'subscription_pending',
        userId: user[f.id],
        tier: syncedUser?.[f.tier] || user[f.tier],
      };
    }

    case 'subscription.canceled':
    case 'subscription.revoked': {
      const periodEndDate = parsePolarTimestamp(periodEnd);
      const isImmediate = type === 'subscription.revoked' || !periodEndDate || periodEndDate <= new Date();

      const patch = {
        [f.polarStatus]: 'canceled',
        [f.polarCancelAtPeriodEnd]: true,
        _subscription: data,
      };

      if (isImmediate) {
        patch[f.tier] = mergedConfig.freeTierName;
        patch.tier = mergedConfig.freeTierName;
      } else {
        patch[f.tier] = user[f.tier];
        patch.tier = user[f.tier];
      }

      await updateUserTier(knex, user, patch, mergedConfig);
      return {
        processed: true,
        action: isImmediate ? 'downgraded_to_free' : 'marked_cancel_pending',
        userId: user[f.id],
      };
    }

    case 'order.created':
    case 'order.updated':
    case 'order.paid':
    case 'checkout.updated': {
      const syncedUser = await syncPolarBillingForUser(user, knex, mergedConfig);
      if (userHasProTier(syncedUser, mergedConfig)) {
        return { processed: true, action: 'order_completed', userId: user[f.id], tier: mergedConfig.proTierName };
      }

      await knex(mergedConfig.userTable).where(f.id, user[f.id]).update({
        [f.polarCustomerId]: customerId || user[f.polarCustomerId],
        updated_at: new Date(),
      });

      return { processed: true, action: 'checkout_recorded', userId: user[f.id], tier: user[f.tier] };
    }

    case 'customer.state_changed': {
      const activeSub = pickBestActiveSubscription(data.active_subscriptions, mergedConfig);
      if (activeSub) {
        await applyPolarProSubscription(knex, user, data, activeSub, mergedConfig);
        return { processed: true, action: 'customer_state_pro', userId: user[f.id], tier: mergedConfig.proTierName };
      }

      const hasNoActiveSubs = Array.isArray(data.active_subscriptions) && data.active_subscriptions.length === 0;
      if (hasNoActiveSubs && userHasProTier(user, mergedConfig)) {
        const patch = {
          [f.tier]: mergedConfig.freeTierName,
          tier: mergedConfig.freeTierName,
          [f.polarStatus]: 'none',
          [f.polarCancelAtPeriodEnd]: false,
          [f.polarCurrentPeriodEnd]: null,
          [f.polarSubscriptionId]: null,
          [f.polarCustomerId]: data.id || user[f.polarCustomerId],
        };
        await updateUserTier(knex, user, patch, mergedConfig);
        return { processed: true, action: 'customer_state_free', userId: user[f.id], tier: mergedConfig.freeTierName };
      }

      if (data.id) {
        await knex(mergedConfig.userTable).where(f.id, user[f.id]).update({
          [f.polarCustomerId]: data.id,
          updated_at: new Date(),
        });
      }

      return { processed: true, action: 'customer_state_recorded', userId: user[f.id], tier: user[f.tier] };
    }

    default:
      return { processed: true, action: 'ignored_event_type', type };
  }
}

function createWebhookRawBodyMiddleware(paths = []) {
  const normalized = new Set(
    (Array.isArray(paths) ? paths : [paths]).map((p) => (p.startsWith('/') ? p : `/${p}`))
  );

  return function polarWebhookRawBody(req, res, next) {
    if (!normalized.has(req.path)) return next();

    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      req.rawBody = Buffer.concat(chunks);
      next();
    });
    req.on('error', next);
  };
}

module.exports = {
  verifyPolarWebhook,
  handlePolarWebhookEvent,
  createWebhookRawBodyMiddleware,
};

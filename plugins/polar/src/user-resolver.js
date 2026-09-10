'use strict';

const PRO_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

function normalizePolarEventData(data) {
  if (!data || typeof data !== 'object') return {};

  const subscription = data.subscription && typeof data.subscription === 'object'
    ? data.subscription
    : null;

  return {
    ...data,
    ...(subscription || {}),
    metadata: data.metadata || subscription?.metadata || data.checkout?.metadata || {},
    customer: data.customer || subscription?.customer || data.checkout?.customer || null,
  };
}

function collectPolarMetadata(data) {
  const normalized = normalizePolarEventData(data);
  const metadata = normalized.metadata && typeof normalized.metadata === 'object'
    ? normalized.metadata
    : {};
  return { normalized, metadata };
}

function isProSubscriptionStatus(status) {
  return PRO_SUBSCRIPTION_STATUSES.has(String(status || '').toLowerCase());
}

function userHasProTier(user, config) {
  if (!user) return false;
  const tierField = config.fields.tier;
  const tier = user[tierField];
  return config.proTiers.includes(tier);
}

function parsePolarTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizePolarTimestamp(value) {
  const parsed = parsePolarTimestamp(value);
  return parsed ? parsed.toISOString() : null;
}

function listPolarSubscriptions(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

function pickBestActiveSubscription(subscriptions, config) {
  const list = Array.isArray(subscriptions) ? subscriptions : [];
  if (!list.length) return null;

  const activeOnly = list.filter((sub) => !sub.status || isProSubscriptionStatus(sub.status));
  if (!activeOnly.length) return null;

  const productIds = new Set();
  for (const planKey of config.proTiers.flatMap((t) => config.tierMapping[t] || [])) {
    const pid = config.plans[planKey];
    if (pid) productIds.add(pid);
  }

  if (productIds.size) {
    const matched = activeOnly.find((sub) => productIds.has(sub.product_id));
    if (matched) return matched;
  }

  return activeOnly[0];
}

function buildCheckoutMetadata(user, config, customFields = {}) {
  const f = config.fields;
  const metadata = {};

  if (user[f.id] != null) metadata.user_id = String(user[f.id]);
  if (user[f.publicId]) metadata.public_id = String(user[f.publicId]);
  if (user.username) metadata.username = String(user.username);

  for (const [key, value] of Object.entries(customFields)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      metadata[key] = String(value);
    }
  }

  const cleaned = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      cleaned[key] = String(value);
    }
  }
  return cleaned;
}

/**
 * @param {Object} data
 * @param {Object} knex
 * @param {import('./config').PolarConfig} config
 */
async function resolveUserFromPolarData(data, knex, config) {
  if (!data || !knex) return null;

  const { normalized, metadata } = collectPolarMetadata(data);
  const f = config.fields;
  const table = config.userTable;

  if (metadata.user_id) {
    const user = await knex(table).where(f.id, Number(metadata.user_id)).first();
    if (user) return user;
  }

  if (metadata.public_id) {
    const user = await knex(table).where(f.publicId, String(metadata.public_id)).first();
    if (user) return user;
  }

  const externalId =
    normalized.external_customer_id
    || normalized.external_id
    || data.external_id
    || normalized.customer?.external_id
    || data.customer?.external_id
    || null;

  if (externalId) {
    let user = await knex(table).where(f.publicId, String(externalId)).first();
    if (!user && /^\d+$/.test(String(externalId))) {
      user = await knex(table).where(f.id, Number(externalId)).first();
    }
    if (user) return user;
  }

  const email = (
    normalized.customer?.email
    || normalized.customer_email
    || normalized.email
    || data.customer?.email
  );
  if (email) {
    const user = await knex(table).whereRaw('LOWER(??) = ?', [f.email, String(email).toLowerCase().trim()]).first();
    if (user) return user;
  }

  const customerId = normalized.customer_id || normalized.customer?.id || data.customer_id || null;
  if (customerId) {
    const user = await knex(table).where(f.polarCustomerId, customerId).first();
    if (user) return user;
  }

  return null;
}

function extractSubscriptionFields(data, user, config) {
  const normalized = normalizePolarEventData(data);
  const f = config.fields;
  return {
    subscriptionId: normalized.id || user?.[f.polarSubscriptionId] || null,
    customerId: normalized.customer_id || normalized.customer?.id || user?.[f.polarCustomerId] || null,
    status: normalized.status || 'active',
    periodEnd: normalizePolarTimestamp(normalized.current_period_end),
    cancelAtPeriodEnd: Boolean(normalized.cancel_at_period_end),
  };
}

function collectExternalCustomerIds(user, config) {
  const f = config.fields;
  return [...new Set([
    user?.[f.publicId] && String(user[f.publicId]),
    user?.[f.id] != null && String(user[f.id]),
  ].filter(Boolean))];
}

module.exports = {
  PRO_SUBSCRIPTION_STATUSES,
  normalizePolarEventData,
  collectPolarMetadata,
  isProSubscriptionStatus,
  userHasProTier,
  parsePolarTimestamp,
  normalizePolarTimestamp,
  listPolarSubscriptions,
  pickBestActiveSubscription,
  buildCheckoutMetadata,
  resolveUserFromPolarData,
  extractSubscriptionFields,
  collectExternalCustomerIds,
};

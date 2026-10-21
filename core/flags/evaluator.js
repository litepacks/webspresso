/**
 * Webspresso Feature Flags: Evaluator
 * Evaluates a flag rule set against an execution context.
 * @module core/flags/evaluator
 */

'use strict';

const { getBucket } = require('./hasher');

/**
 * Normalizes an execution context to extract distinctId, roles, and emails
 * @param {Object} [context]
 * @returns {Object}
 */
function normalizeContext(context = {}) {
  const user = context.user || null;
  const distinctId = context.distinctId
    || user?.id
    || user?.userId
    || context.id
    || context.userId
    || context.session?.userId
    || context.ip
    || 'anonymous';

  const roles = new Set();
  if (context.role) roles.add(context.role);
  if (Array.isArray(context.roles)) context.roles.forEach((r) => roles.add(r));
  if (user?.role) roles.add(user.role);
  if (Array.isArray(user?.roles)) user.roles.forEach((r) => roles.add(r));

  const email = (context.email || user?.email || '').toLowerCase().trim();
  const emailDomain = email.includes('@') ? email.split('@').pop() : '';

  return {
    ...context,
    user,
    distinctId: String(distinctId),
    roles,
    email,
    emailDomain,
  };
}

/**
 * Check if an environment override is active for this flag key
 * @param {string} flagKey
 * @param {string} [prefix='FEATURE_']
 * @returns {boolean|null}
 */
function checkEnvOverride(flagKey, prefix = 'FEATURE_') {
  const envName = `${prefix}${flagKey.replace(/[-.]/g, '_').toUpperCase()}`;
  const envVal = process.env[envName];
  if (envVal === undefined) return null;

  const trimmed = envVal.trim().toLowerCase();
  if (trimmed === 'true' || trimmed === '1' || trimmed === 'on' || trimmed === 'yes') {
    return true;
  }
  if (trimmed === 'false' || trimmed === '0' || trimmed === 'off' || trimmed === 'no') {
    return false;
  }
  return null;
}

/**
 * Evaluates a flag against context
 * @param {string} flagKey
 * @param {Object|boolean} definition
 * @param {Object} [rawContext]
 * @param {Object} [options]
 * @returns {{ enabled: boolean, variant: string|null, reason: string, bucket?: number }}
 */
function evaluateFlag(flagKey, definition, rawContext = {}, options = {}) {
  // 1. Check environment variable override
  const envPrefix = options.envPrefix || 'FEATURE_';
  const envOverride = checkEnvOverride(flagKey, envPrefix);
  if (envOverride !== null) {
    return {
      enabled: envOverride,
      variant: null,
      reason: 'env_override',
    };
  }

  // 2. Undefined or null definition -> false
  if (definition === undefined || definition === null) {
    return {
      enabled: false,
      variant: null,
      reason: 'not_found',
    };
  }

  // 3. Simple boolean definition
  if (typeof definition === 'boolean') {
    return {
      enabled: definition,
      variant: null,
      reason: definition ? 'boolean_true' : 'boolean_false',
    };
  }

  // 4. Object definition
  if (typeof definition === 'object') {
    // If master toggle explicitly set to false
    if (definition.enabled === false) {
      return {
        enabled: false,
        variant: null,
        reason: 'master_disabled',
      };
    }

    const ctx = normalizeContext(rawContext);

    // 4.1 Target users whitelist (ID or email)
    if (Array.isArray(definition.users) && definition.users.length > 0) {
      const match = definition.users.some(
        (u) => String(u) === ctx.distinctId || (ctx.email && String(u).toLowerCase() === ctx.email)
      );
      if (match) {
        return {
          enabled: true,
          variant: definition.variant || null,
          reason: 'targeted_user',
        };
      }
    }

    // 4.2 Target roles
    if (Array.isArray(definition.roles) && definition.roles.length > 0) {
      const match = definition.roles.some((r) => ctx.roles.has(r));
      if (match) {
        return {
          enabled: true,
          variant: definition.variant || null,
          reason: 'targeted_role',
        };
      }
    }

    // 4.3 Target email domains
    if (Array.isArray(definition.emailDomains) && definition.emailDomains.length > 0 && ctx.emailDomain) {
      const match = definition.emailDomains.some((d) => d.toLowerCase().replace(/^@/, '') === ctx.emailDomain);
      if (match) {
        return {
          enabled: true,
          variant: definition.variant || null,
          reason: 'targeted_email_domain',
        };
      }
    }

    // 4.4 Custom condition callback
    if (typeof definition.condition === 'function') {
      try {
        const condResult = Boolean(definition.condition(ctx));
        if (condResult) {
          return {
            enabled: true,
            variant: definition.variant || null,
            reason: 'condition_passed',
          };
        }
      } catch (_) {
        // If condition throws, fallback
      }
    }

    // 4.5 Multivariate A/B testing variants
    if (Array.isArray(definition.variants) && definition.variants.length > 0) {
      const bucket = getBucket(flagKey, ctx.distinctId);
      let cumulative = 0;
      let totalWeight = definition.variants.reduce((acc, v) => acc + (Number(v.weight) || 0), 0);
      if (totalWeight <= 0) totalWeight = 100;

      for (const v of definition.variants) {
        const weightPercent = ((Number(v.weight) || 0) / totalWeight) * 100;
        cumulative += weightPercent;
        if (bucket < cumulative) {
          return {
            enabled: true,
            variant: v.name || v.key || String(v),
            reason: 'variant_match',
            bucket,
          };
        }
      }
      return {
        enabled: true,
        variant: definition.variants[0].name || null,
        reason: 'variant_fallback',
        bucket,
      };
    }

    // 4.6 Percentage rollout / Canary traffic splitting
    if (typeof definition.rollout === 'number') {
      const rolloutPercent = Math.max(0, Math.min(100, definition.rollout));
      if (rolloutPercent === 0) {
        return { enabled: false, variant: null, reason: 'rollout_zero', bucket: 0 };
      }
      if (rolloutPercent === 100) {
        return { enabled: true, variant: definition.variant || null, reason: 'rollout_full', bucket: 0 };
      }

      const bucket = getBucket(flagKey, ctx.distinctId);
      const isIncluded = bucket < rolloutPercent;
      return {
        enabled: isIncluded,
        variant: isIncluded ? (definition.variant || null) : null,
        reason: isIncluded ? 'rollout_match' : 'rollout_miss',
        bucket,
      };
    }

    // 4.7 Fallback default
    const fallback = definition.default !== undefined
      ? Boolean(definition.default)
      : (definition.enabled !== undefined ? Boolean(definition.enabled) : true);

    return {
      enabled: fallback,
      variant: fallback ? (definition.variant || null) : null,
      reason: 'default_fallback',
    };
  }

  return {
    enabled: Boolean(definition),
    variant: null,
    reason: 'coerced_truthy',
  };
}

module.exports = {
  evaluateFlag,
  normalizeContext,
  checkEnvOverride,
};

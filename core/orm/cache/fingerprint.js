/**
 * Stable cache key fingerprint for ORM reads
 * @module core/orm/cache/fingerprint
 */

const crypto = require('crypto');

/**
 * @param {*} v
 * @returns {*}
 */
function stableValue(v) {
  if (v === null || v === undefined) return v;
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(stableValue);
  const keys = Object.keys(v).sort();
  const out = {};
  for (const k of keys) out[k] = stableValue(v[k]);
  return out;
}

/**
 * @param {import('../types').ScopeContext} scopeContext
 */
function scopeFingerprint(scopeContext) {
  return {
    tenantId: scopeContext.tenantId,
    withTrashed: !!scopeContext.withTrashed,
    onlyTrashed: !!scopeContext.onlyTrashed,
  };
}

/**
 * @param {import('../types').QueryState} state
 */
function serializeWheres(wheres) {
  return wheres.map((w) => {
    if (w.raw) {
      return { raw: true, sql: w.sql, bindings: w.bindings, boolean: w.boolean };
    }
    return {
      column: w.column,
      operator: w.operator,
      value: w.value,
      boolean: w.boolean,
    };
  });
}

/**
 * @param {import('../model').ModelDefinition} model
 * @param {import('../types').ScopeContext} scopeContext
 * @param {object} parts
 * @returns {string} hex key
 */
function hashKey(model, scopeContext, parts) {
  const payload = stableValue({
    model: model.name,
    table: model.table,
    pk: model.primaryKey,
    scope: scopeFingerprint(scopeContext),
    ...parts,
  });
  const json = JSON.stringify(payload);
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 40);
}

module.exports = {
  stableValue,
  scopeFingerprint,
  serializeWheres,
  hashKey,
};

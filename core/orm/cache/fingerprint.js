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
  if (Array.isArray(v)) {
    const len = v.length;
    if (len === 0) return v;
    const out = new Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = stableValue(v[i]);
    }
    return out;
  }
  const keys = Object.keys(v);
  const keyLen = keys.length;
  if (keyLen === 0) return v;
  if (keyLen === 1) {
    const k = keys[0];
    return { [k]: stableValue(v[k]) };
  }
  keys.sort();
  const out = {};
  for (let i = 0; i < keyLen; i++) {
    const k = keys[i];
    out[k] = stableValue(v[k]);
  }
  return out;
}

/**
 * @param {import('../types').ScopeContext} scopeContext
 */
function scopeFingerprint(scopeContext) {
  return {
    onlyTrashed: !!scopeContext.onlyTrashed,
    tenantId: scopeContext.tenantId ?? null,
    withTrashed: !!scopeContext.withTrashed,
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

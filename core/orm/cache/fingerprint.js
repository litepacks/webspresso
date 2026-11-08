/**
 * Stable cache key fingerprint for ORM reads
 * @module core/orm/cache/fingerprint
 */

const { sha256 } = require('../../utils/crypto');

/**
 * @param {*} v
 * @returns {*}
 */
function stableValue(v) {
  if (v === null || v === undefined) return v;
  const type = typeof v;
  if (type !== 'object') return v;
  if (v instanceof Date || Buffer.isBuffer(v)) return v;

  if (Array.isArray(v)) {
    const len = v.length;
    if (len === 0) return v;
    let needsTransform = false;
    for (let i = 0; i < len; i++) {
      const item = v[i];
      if (item !== null && typeof item === 'object') {
        needsTransform = true;
        break;
      }
    }
    if (!needsTransform) return v;
    const out = new Array(len);
    for (let i = 0; i < len; i++) {
      const item = v[i];
      out[i] = (item !== null && typeof item === 'object') ? stableValue(item) : item;
    }
    return out;
  }

  const keys = Object.keys(v);
  const keyLen = keys.length;
  if (keyLen === 0) return v;
  if (keyLen === 1) {
    const k = keys[0];
    const val = v[k];
    const s = (val !== null && typeof val === 'object') ? stableValue(val) : val;
    return { [k]: s };
  }
  if (keyLen === 2) {
    const k0 = keys[0];
    const k1 = keys[1];
    const val0 = v[k0];
    const val1 = v[k1];
    const s0 = (val0 !== null && typeof val0 === 'object') ? stableValue(val0) : val0;
    const s1 = (val1 !== null && typeof val1 === 'object') ? stableValue(val1) : val1;
    return k0 < k1
      ? { [k0]: s0, [k1]: s1 }
      : { [k1]: s1, [k0]: s0 };
  }
  let isSorted = true;
  let hasObjects = false;
  for (let i = 0; i < keyLen; i++) {
    if (i > 0 && keys[i - 1] > keys[i]) isSorted = false;
    const val = v[keys[i]];
    if (val !== null && typeof val === 'object') hasObjects = true;
  }
  if (!isSorted) keys.sort();
  const out = {};
  for (let i = 0; i < keyLen; i++) {
    const k = keys[i];
    const val = v[k];
    out[k] = (val !== null && typeof val === 'object') ? stableValue(val) : val;
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
  return sha256(json).slice(0, 40);
}

module.exports = {
  stableValue,
  scopeFingerprint,
  serializeWheres,
  hashKey,
};

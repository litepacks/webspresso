/**
 * Hidden column serialization for ORM results
 * Records keep every column for code (e.g. `user.password` for login checks), but gain a
 * non-enumerable toJSON() that omits the model's `hidden` columns, so `res.json(record)`,
 * `JSON.stringify` and session serialization never expose them.
 * @module core/orm/hidden
 */

const { resolveRelationModel } = require('./model');

/**
 * @param {string[]} hidden
 * @returns {Function}
 */
function createHiddenToJSON(hidden) {
  return function toJSON() {
    const out = {};
    for (const key of Object.keys(this)) {
      if (!hidden.includes(key)) out[key] = this[key];
    }
    return out;
  };
}

/**
 * Attach hidden-column serialization to a record, an array of records, or a paginated
 * result (`{ data: [...] }`), recursing into loaded relations with their own models.
 * Mutates and returns the given value.
 * @param {import('./types').ModelDefinition} model
 * @param {*} value
 * @param {WeakSet<object>} [seen]
 * @returns {*}
 */
function applyHiddenSerialization(model, value, seen = new WeakSet()) {
  if (!model || !value || typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) applyHiddenSerialization(model, item, seen);
    return value;
  }
  if (seen.has(value)) return value;
  seen.add(value);

  // Paginated result: { data: [...], total, page, ... }
  if (Array.isArray(value.data) && 'total' in value) {
    applyHiddenSerialization(model, value.data, seen);
    return value;
  }

  for (const [name, relation] of Object.entries(model.relations || {})) {
    const related = value[name];
    if (!related || typeof related !== 'object') continue;
    let relatedModel;
    try {
      relatedModel = resolveRelationModel(relation);
    } catch {
      continue;
    }
    applyHiddenSerialization(relatedModel, related, seen);
  }

  const hidden = Array.isArray(model.hidden) ? model.hidden : [];
  if (hidden.length > 0 && !Object.prototype.hasOwnProperty.call(value, 'toJSON')) {
    Object.defineProperty(value, 'toJSON', {
      value: createHiddenToJSON(hidden),
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  return value;
}

module.exports = {
  applyHiddenSerialization,
};

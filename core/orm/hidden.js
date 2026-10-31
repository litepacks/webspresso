/**
 * Hidden column serialization for ORM results
 * Records keep every column for code (e.g. `user.password` for login checks), but gain a
 * non-enumerable toJSON() that omits the model's `hidden` columns, so `res.json(record)`,
 * `JSON.stringify` and session serialization never expose them.
 * @module core/orm/hidden
 */

const { resolveRelationModel } = require('./model');

/**
 * Per-model serialization plan, built once: the shared toJSON descriptor (null when the
 * model hides nothing) and the relation names to recurse into.
 * @type {WeakMap<object, { descriptor: PropertyDescriptor|null, relations: string[] }>}
 */
const plans = new WeakMap();

function getPlan(model) {
  let plan = plans.get(model);
  if (plan) return plan;

  const hidden = Array.isArray(model.hidden) ? model.hidden : [];
  let descriptor = null;
  if (hidden.length > 0) {
    const hiddenSet = new Set(hidden);
    descriptor = {
      value: function toJSON() {
        const out = {};
        for (const key of Object.keys(this)) {
          if (!hiddenSet.has(key)) out[key] = this[key];
        }
        return out;
      },
      enumerable: false,
      configurable: true,
      writable: true,
    };
  }
  plan = { descriptor, relations: Object.keys(model.relations || {}) };
  plans.set(model, plan);
  return plan;
}

function resolveRelated(model, name) {
  try {
    return resolveRelationModel(model.relations[name]);
  } catch {
    return null;
  }
}

/**
 * Attach hidden-column serialization to a record, an array of records, or a paginated
 * result (`{ data: [...] }`), recursing into loaded relations with their own models.
 * Mutates and returns the given value.
 * @param {import('./types').ModelDefinition} model
 * @param {*} value
 * @param {WeakSet<object>} [seen] - Guards against cycles in loaded relation graphs
 * @returns {*}
 */
function applyHiddenSerialization(model, value, seen) {
  if (!model || !value || typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) {
    return value;
  }

  const plan = getPlan(model);

  if (Array.isArray(value)) {
    // Fast path: plain rows with no relations to walk
    if (plan.relations.length === 0) {
      if (plan.descriptor) {
        for (const item of value) {
          if (item && typeof item === 'object' && !Object.prototype.hasOwnProperty.call(item, 'toJSON')) {
            Object.defineProperty(item, 'toJSON', plan.descriptor);
          }
        }
      }
      return value;
    }
    for (const item of value) applyHiddenSerialization(model, item, seen);
    return value;
  }

  // Paginated result: { data: [...], total, page, ... }
  if (Array.isArray(value.data) && 'total' in value) {
    applyHiddenSerialization(model, value.data, seen);
    return value;
  }

  if (plan.relations.length > 0) {
    seen = seen || new WeakSet();
    if (seen.has(value)) return value;
    seen.add(value);
    for (const name of plan.relations) {
      const related = value[name];
      if (!related || typeof related !== 'object') continue;
      const relatedModel = resolveRelated(model, name);
      if (relatedModel) applyHiddenSerialization(relatedModel, related, seen);
    }
  }

  if (plan.descriptor && !Object.prototype.hasOwnProperty.call(value, 'toJSON')) {
    Object.defineProperty(value, 'toJSON', plan.descriptor);
  }
  return value;
}

module.exports = {
  applyHiddenSerialization,
};

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
 * model hides nothing), relation names, and a cached map of resolved relation models.
 * @type {WeakMap<object, { descriptor: PropertyDescriptor|null, relations: string[], relationMap: Map<string, object> }>}
 */
const plans = new WeakMap();

function getPlan(model) {
  let plan = model._hiddenPlan || plans.get(model);
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
  const relations = Object.keys(model.relations || {});
  const isNoop = !descriptor && relations.length === 0;
  plan = { descriptor, relations, isNoop, relationMap: new Map() };
  try {
    model._hiddenPlan = plan;
  } catch {}
  plans.set(model, plan);
  return plan;
}

function resolveRelated(plan, model, name) {
  let relatedModel = plan.relationMap.get(name);
  if (relatedModel !== undefined) return relatedModel;

  try {
    relatedModel = resolveRelationModel(model.relations[name]);
  } catch {
    relatedModel = null;
  }
  if (relatedModel) {
    plan.relationMap.set(name, relatedModel);
  }
  return relatedModel;
}

function applySingleRecord(plan, model, value, seen) {
  if (seen.has(value)) return;
  seen.add(value);

  if (plan.relations.length > 0) {
    for (let i = 0; i < plan.relations.length; i++) {
      const name = plan.relations[i];
      const related = value[name];
      if (!related || typeof related !== 'object') continue;
      const relatedModel = resolveRelated(plan, model, name);
      if (relatedModel) {
        const relatedPlan = relatedModel._hiddenPlan || getPlan(relatedModel);
        if (!relatedPlan.isNoop) {
          applyHiddenSerialization(relatedModel, related, seen);
        }
      }
    }
  }

  if (plan.descriptor && !Object.prototype.hasOwnProperty.call(value, 'toJSON')) {
    Object.defineProperty(value, 'toJSON', plan.descriptor);
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

  const plan = model._hiddenPlan || getPlan(model);
  if (plan.isNoop) return value;

  if (Array.isArray(value)) {
    const len = value.length;
    if (len === 0) return value;

    // Fast path: plain rows with no relations to walk
    if (plan.relations.length === 0) {
      if (plan.descriptor) {
        for (let i = 0; i < len; i++) {
          const item = value[i];
          if (item && typeof item === 'object' && !Object.prototype.hasOwnProperty.call(item, 'toJSON')) {
            Object.defineProperty(item, 'toJSON', plan.descriptor);
          }
        }
      }
      return value;
    }

    seen = seen || new WeakSet();
    for (let i = 0; i < len; i++) {
      const item = value[i];
      if (item && typeof item === 'object') {
        applySingleRecord(plan, model, item, seen);
      }
    }
    return value;
  }

  // Paginated result: { data: [...], total, page, ... }
  if (Array.isArray(value.data) && 'total' in value) {
    applyHiddenSerialization(model, value.data, seen);
    return value;
  }

  seen = seen || new WeakSet();
  applySingleRecord(plan, model, value, seen);
  return value;
}

module.exports = {
  applyHiddenSerialization,
};

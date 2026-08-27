/**
 * REST resource plugin — opt-in CRUD routes from ORM models, eager-loaded includes (no N+1)
 * @module plugins/rest-resources
 */

const { attachDbMiddleware } = require('../../src/app-context');
const { getAllModels } = require('../../core/orm/model');
const { omit } = require('../../core/orm/utils');
const { trimUrlPathSlashes } = require('../../core/url-path-normalize');
const { validateQueryComplexity } = require('../../core/orm/complexity');

const RESERVED_QUERY_KEYS = new Set(['page', 'perPage', 'sort', 'order', 'include', 'trashed']);

/**
 * Pluralize a PascalCase model name to a URL segment (e.g. User -> users, Company -> companies)
 * @param {string} modelName
 * @returns {string}
 */
function pluralizeSegment(modelName) {
  const base = modelName.charAt(0).toLowerCase() + modelName.slice(1);
  if (base.length >= 2 && base.endsWith('y') && !'aeiou'.includes(base[base.length - 2])) {
    return `${base.slice(0, -1)}ies`;
  }
  if (/(s|x|z|ch|sh)$/i.test(base)) {
    return `${base}es`;
  }
  return `${base}s`;
}

/**
 * @param {import('../../core/orm/types').ModelDefinition} model
 * @param {string} raw
 * @returns {string[]}
 */
function parseIncludeParam(model, raw) {
  if (raw == null || raw === '') {
    return [];
  }
  const str = typeof raw === 'string' ? raw : String(raw);
  const names = str
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const allowedRelationNames = model.rest?.allowInclude?.length
    ? new Set(model.rest.allowInclude)
    : new Set(Object.keys(model.relations));

  const out = [];
  for (const name of names) {
    if (name.includes('.')) {
      continue;
    }
    if (!allowedRelationNames.has(name) || !model.relations[name]) {
      continue;
    }
    out.push(name);
  }
  return out;
}

/**
 * Strip hidden columns and recurse into loaded relations (belongsTo / hasOne / hasMany).
 * @param {Object|Object[]|null} record
 * @param {import('../../core/orm/types').ModelDefinition} model
 * @returns {Object|Object[]|null}
 */
function sanitizeRecordTree(record, model) {
  if (record == null) {
    return record;
  }
  if (Array.isArray(record)) {
    return record.map((r) => sanitizeRecordTree(r, model));
  }
  if (typeof record !== 'object') {
    return record;
  }

  let base = model.hidden?.length ? omit(record, model.hidden) : { ...record };

  for (const [relName, rel] of Object.entries(model.relations)) {
    if (!(relName in base)) {
      continue;
    }
    const relatedModel = rel.model();
    const val = base[relName];
    if (rel.type === 'hasMany') {
      base[relName] = Array.isArray(val) ? val.map((item) => sanitizeRecordTree(item, relatedModel)) : val;
    } else {
      base[relName] = sanitizeRecordTree(val, relatedModel);
    }
  }

  return base;
}

/**
 * Only real table columns; drop relations and hidden (aligned with repo validation).
 * @param {Object} body
 * @param {import('../../core/orm/types').ModelDefinition} model
 * @returns {Object}
 */
function pickWritableColumns(body, model) {
  const out = {};
  if (!body || typeof body !== 'object') {
    return out;
  }
  for (const key of Object.keys(body)) {
    if (!model.columns.has(key)) {
      continue;
    }
    const meta = model.columns.get(key);
    if (meta.primary && meta.autoIncrement) {
      continue;
    }
    out[key] = body[key];
  }
  for (const h of model.hidden || []) {
    delete out[h];
  }
  return out;
}

/**
 * @param {object} db
 * @param {object} opts
 * @param {string[]|null} [opts.models]
 * @param {string[]} [opts.excludeModels]
 * @param {function(import('../../core/orm/types').ModelDefinition): boolean} [opts.filter]
 * @returns {import('../../core/orm/types').ModelDefinition[]}
 */
function resolveExposedModels(db, opts) {
  const allModels = db && typeof db.getAllModels === 'function'
    ? Array.from(db.getAllModels().values())
    : Array.from(getAllModels().values());

  const exclude = new Set(opts.excludeModels || []);
  let list = allModels.filter((m) => !exclude.has(m.name));

  if (opts.models && opts.models.length > 0) {
    const allow = new Set(opts.models);
    list = list.filter((m) => allow.has(m.name));
  } else {
    list = list.filter((m) => m.rest && m.rest.enabled === true);
  }

  if (typeof opts.filter === 'function') {
    list = list.filter(opts.filter);
  }

  return list;
}

function normalizeBasePath(p) {
  return `/${trimUrlPathSlashes(p)}`;
}

function applySoftDeleteScope(query, countQuery, model, trashed) {
  if (!model.scopes?.softDelete) {
    return { query, countQuery };
  }
  if (trashed === 'only') {
    return { query: query.onlyTrashed(), countQuery: countQuery.onlyTrashed() };
  }
  if (trashed === 'include') {
    return { query: query.withTrashed(), countQuery: countQuery.withTrashed() };
  }
  return { query, countQuery };
}

/**
 * Parse sort parameters into an array of { column, direction }
 * @param {import('../../core/orm/types').ModelDefinition} model
 * @param {*} rawSort
 * @param {*} rawOrder
 * @returns {Array<{ column: string, direction: 'asc'|'desc' }>}
 */
function parseSortParams(model, rawSort, rawOrder) {
  const result = [];
  const seen = new Set();

  function addSort(col, dir) {
    if (!col || typeof col !== 'string') return;
    const cleanCol = col.trim();
    if (!model.columns.has(cleanCol) || seen.has(cleanCol)) return;
    seen.add(cleanCol);
    const cleanDir = String(dir || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
    result.push({ column: cleanCol, direction: cleanDir });
  }

  if (Array.isArray(rawSort)) {
    for (const item of rawSort) {
      if (typeof item === 'string') {
        const tokens = item.split(',').map((s) => s.trim()).filter(Boolean);
        for (const token of tokens) {
          if (token.startsWith('-')) {
            addSort(token.slice(1), 'desc');
          } else if (token.startsWith('+')) {
            addSort(token.slice(1), 'asc');
          } else if (token.includes(':')) {
            const [c, d] = token.split(':');
            addSort(c, d);
          } else {
            addSort(token, rawOrder || 'asc');
          }
        }
      }
    }
  } else if (typeof rawSort === 'string' && rawSort.trim() !== '') {
    const tokens = rawSort.split(',').map((s) => s.trim()).filter(Boolean);
    for (const token of tokens) {
      if (token.startsWith('-')) {
        addSort(token.slice(1), 'desc');
      } else if (token.startsWith('+')) {
        addSort(token.slice(1), 'asc');
      } else if (token.includes(':')) {
        const [c, d] = token.split(':');
        addSort(c, d);
      } else if (tokens.length === 1 && rawOrder) {
        addSort(token, rawOrder);
      } else {
        addSort(token, 'asc');
      }
    }
  }

  if (result.length === 0) {
    result.push({
      column: model.primaryKey,
      direction: String(rawOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc',
    });
  }

  return result;
}

function applyColumnFilters(query, countQuery, model, req) {
  let q = query;
  let c = countQuery;

  function applyCondition(col, op, rawVal) {
    if (!model.columns.has(col)) return;
    const meta = model.columns.get(col);
    const colType = meta?.type;

    let operator = String(op || 'eq').toLowerCase();
    let val = rawVal;

    // Normalize booleans
    if (colType === 'boolean' && typeof val === 'string') {
      if (val === 'true' || val === '1') val = true;
      else if (val === 'false' || val === '0') val = false;
    }

    switch (operator) {
      case 'eq':
      case '=':
        if (val !== undefined && val !== '') {
          q = q.where(col, '=', val);
          c = c.where(col, '=', val);
        }
        break;

      case 'ne':
      case '!=':
      case '<>':
        if (val !== undefined && val !== '') {
          q = q.where(col, '!=', val);
          c = c.where(col, '!=', val);
        }
        break;

      case 'gt':
      case '>':
        if (val !== undefined && val !== '') {
          q = q.where(col, '>', val);
          c = c.where(col, '>', val);
        }
        break;

      case 'gte':
      case '>=':
        if (val !== undefined && val !== '') {
          q = q.where(col, '>=', val);
          c = c.where(col, '>=', val);
        }
        break;

      case 'lt':
      case '<':
        if (val !== undefined && val !== '') {
          q = q.where(col, '<', val);
          c = c.where(col, '<', val);
        }
        break;

      case 'lte':
      case '<=':
        if (val !== undefined && val !== '') {
          q = q.where(col, '<=', val);
          c = c.where(col, '<=', val);
        }
        break;

      case 'in': {
        const arr = Array.isArray(val)
          ? val
          : (typeof val === 'string' ? val.split(',').map(s => s.trim()).filter(Boolean) : [val]);
        if (arr.length > 0) {
          q = q.whereIn(col, arr);
          c = c.whereIn(col, arr);
        }
        break;
      }

      case 'nin':
      case 'notin': {
        const arr = Array.isArray(val)
          ? val
          : (typeof val === 'string' ? val.split(',').map(s => s.trim()).filter(Boolean) : [val]);
        if (arr.length > 0) {
          q = q.whereNotIn(col, arr);
          c = c.whereNotIn(col, arr);
        }
        break;
      }

      case 'like':
        if (val !== undefined && val !== '') {
          q = q.where(col, 'like', String(val));
          c = c.where(col, 'like', String(val));
        }
        break;

      case 'ilike':
        if (val !== undefined && val !== '') {
          q = q.where(col, 'ilike', String(val));
          c = c.where(col, 'ilike', String(val));
        }
        break;

      case 'contains':
        if (val !== undefined && val !== '') {
          q = q.where(col, 'like', `%${String(val)}%`);
          c = c.where(col, 'like', `%${String(val)}%`);
        }
        break;

      case 'startswith':
        if (val !== undefined && val !== '') {
          q = q.where(col, 'like', `${String(val)}%`);
          c = c.where(col, 'like', `${String(val)}%`);
        }
        break;

      case 'endswith':
        if (val !== undefined && val !== '') {
          q = q.where(col, 'like', `%${String(val)}`);
          c = c.where(col, 'like', `%${String(val)}`);
        }
        break;

      case 'isnull':
      case 'is_null': {
        const isTrue = val === true || val === 'true' || val === '1' || val === 1 || val === '';
        if (isTrue) {
          q = q.whereNull(col);
          c = c.whereNull(col);
        }
        break;
      }

      case 'isnotnull':
      case 'is_not_null': {
        const isTrue = val === true || val === 'true' || val === '1' || val === 1 || val === '';
        if (isTrue) {
          q = q.whereNotNull(col);
          c = c.whereNotNull(col);
        }
        break;
      }

      case 'between': {
        let parts = [];
        if (Array.isArray(val)) {
          parts = val;
        } else if (typeof val === 'string') {
          parts = val.split(',').map(s => s.trim());
        }
        if (parts.length === 2 && parts[0] !== '' && parts[1] !== '') {
          q = q.where(col, '>=', parts[0]).where(col, '<=', parts[1]);
          c = c.where(col, '>=', parts[0]).where(col, '<=', parts[1]);
        }
        break;
      }

      default:
        if (val !== undefined && val !== '') {
          q = q.where(col, '=', val);
          c = c.where(col, '=', val);
        }
        break;
    }
  }

  // 1. Process dedicated filter object ?filter[col]=... or ?filter[col][op]=...
  if (req.query.filter && typeof req.query.filter === 'object') {
    for (const [col, colFilter] of Object.entries(req.query.filter)) {
      if (!model.columns.has(col)) continue;
      if (colFilter && typeof colFilter === 'object' && !Array.isArray(colFilter)) {
        if (colFilter.op !== undefined && colFilter.value !== undefined) {
          applyCondition(col, colFilter.op, colFilter.value);
        } else {
          for (const [op, val] of Object.entries(colFilter)) {
            applyCondition(col, op, val);
          }
        }
      } else if (colFilter !== undefined && colFilter !== '') {
        applyCondition(col, 'eq', colFilter);
      }
    }
  }

  // 2. Process top-level query parameters ?price[gte]=100 or ?status=active
  for (const [key, value] of Object.entries(req.query)) {
    if (RESERVED_QUERY_KEYS.has(key) || key === 'filter') {
      continue;
    }
    if (!model.columns.has(key)) {
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [op, val] of Object.entries(value)) {
        applyCondition(key, op, val);
      }
    } else if (value !== undefined && value !== '') {
      applyCondition(key, 'eq', value);
    }
  }

  return { query: q, countQuery: c };
}

/**
 * @param {Object} options
 * @param {string} [options.path='/api/rest'] - Base path (no trailing slash)
 * @param {import('express').RequestHandler[]} [options.middleware] - Before attachDbMiddleware
 * @param {string[]} [options.models] - Whitelist model names (ignores rest.enabled when set)
 * @param {string[]} [options.excludeModels] - Exclude model names
 * @param {function(import('../../core/orm/types').ModelDefinition): boolean} [options.filter] - Extra filter
 */
function restResourcePlugin(options = {}) {
  const {
    path: basePath = '/api/rest',
    middleware = [],
    models: modelNameWhitelist = null,
    excludeModels = [],
    filter: modelFilter = null,
  } = options;

  const normalizedBase = normalizeBasePath(basePath);
  const extra = Array.isArray(middleware) ? middleware : [];

  return {
    name: 'rest-resources',
    version: '1.0.0',

    onRoutesReady(ctx) {
      const db = ctx.db ?? ctx.options?.db;
      if (!db) {
        console.warn('[rest-resources] Skipping routes: createApp({ db }) is required');
        return;
      }

      const exposed = resolveExposedModels(db, {
        models: modelNameWhitelist,
        excludeModels,
        filter: modelFilter,
      });

      const chain = (handler) => [...extra, attachDbMiddleware, handler];

      for (const model of exposed) {
        const segment = model.rest?.path || pluralizeSegment(model.name);
        const base = `${normalizedBase}/${segment}`;

        ctx.addRoute(
          'get',
          base,
          ...chain(async (req, res) => {
            try {
              const repo = db.getRepository(model.name);
              const complexity = validateQueryComplexity(model, {
                perPage: req.query.perPage,
                includes: parseIncludeParam(model, req.query.include),
                strict: false,
              });
              const page = Math.max(1, parseInt(req.query.page, 10) || 1);
              const perPage = complexity.perPage;
              const offset = (page - 1) * perPage;
              const include = complexity.includes;

              let query = repo.query();
              let countQuery = repo.query();
              ({ query, countQuery } = applySoftDeleteScope(query, countQuery, model, req.query.trashed));
              ({ query, countQuery } = applyColumnFilters(query, countQuery, model, req));

              const sortEntries = parseSortParams(model, req.query.sort, req.query.order);

              const total = await countQuery.count();
              let listQ = query;
              for (const s of sortEntries) {
                listQ = listQ.orderBy(s.column, s.direction);
              }
              listQ = listQ.offset(offset).limit(perPage);
              if (include.length > 0) {
                listQ = listQ.with(...include);
              }
              const records = await listQ.list();

              res.json({
                data: sanitizeRecordTree(records, model),
                pagination: {
                  page,
                  perPage,
                  total,
                  totalPages: Math.ceil(total / perPage) || 0,
                },
              });
            } catch (err) {
              res.status(400).json({ error: err.message });
            }
          })
        );

        ctx.addRoute(
          'get',
          `${base}/:id`,
          ...chain(async (req, res) => {
            try {
              const repo = db.getRepository(model.name);
              const complexity = validateQueryComplexity(model, {
                includes: parseIncludeParam(model, req.query.include),
                strict: false,
              });
              const include = complexity.includes;
              const record = await repo.findById(req.params.id, { with: include });

              if (!record) {
                return res.status(404).json({ error: 'Record not found' });
              }
              res.json({ data: sanitizeRecordTree(record, model) });
            } catch (err) {
              res.status(400).json({ error: err.message });
            }
          })
        );

        ctx.addRoute(
          'post',
          base,
          ...chain(async (req, res) => {
            try {
              const repo = db.getRepository(model.name);
              const payload = pickWritableColumns(req.body, model);
              const record = await repo.create(payload);
              res.status(201).json({ data: sanitizeRecordTree(record, model) });
            } catch (err) {
              res.status(400).json({ error: err.message });
            }
          })
        );

        ctx.addRoute(
          'patch',
          `${base}/:id`,
          ...chain(async (req, res) => {
            try {
              const repo = db.getRepository(model.name);
              const payload = pickWritableColumns(req.body, model);
              const record = await repo.update(req.params.id, payload);
              if (!record) {
                return res.status(404).json({ error: 'Record not found' });
              }
              res.json({ data: sanitizeRecordTree(record, model) });
            } catch (err) {
              res.status(400).json({ error: err.message });
            }
          })
        );

        ctx.addRoute(
          'delete',
          `${base}/:id`,
          ...chain(async (req, res) => {
            try {
              const repo = db.getRepository(model.name);
              const ok = await repo.delete(req.params.id);
              if (!ok) {
                return res.status(404).json({ error: 'Record not found' });
              }
              res.json({ success: true });
            } catch (err) {
              res.status(400).json({ error: err.message });
            }
          })
        );
      }
    },
  };
}

module.exports = restResourcePlugin;
module.exports.pluralizeSegment = pluralizeSegment;
module.exports.parseIncludeParam = parseIncludeParam;
module.exports.parseSortParams = parseSortParams;
module.exports.applyColumnFilters = applyColumnFilters;
module.exports.sanitizeRecordTree = sanitizeRecordTree;
module.exports.pickWritableColumns = pickWritableColumns;
module.exports.resolveExposedModels = resolveExposedModels;

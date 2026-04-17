/**
 * REST resource plugin — opt-in CRUD routes from ORM models, eager-loaded includes (no N+1)
 * @module plugins/rest-resources
 */

const { attachDbMiddleware } = require('../../src/app-context');
const { getAllModels } = require('../../core/orm/model');
const { omit } = require('../../core/orm/utils');

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
  return `/${String(p).replace(/^\/+|\/+$/g, '')}`;
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

function applyColumnFilters(query, countQuery, model, req) {
  let q = query;
  let c = countQuery;
  for (const [key, value] of Object.entries(req.query)) {
    if (RESERVED_QUERY_KEYS.has(key)) {
      continue;
    }
    if (!model.columns.has(key)) {
      continue;
    }
    if (value === undefined || value === '') {
      continue;
    }
    q = q.where(key, value);
    c = c.where(key, value);
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
              const page = Math.max(1, parseInt(req.query.page, 10) || 1);
              const perPage = Math.min(100, Math.max(1, parseInt(req.query.perPage, 10) || 15));
              const offset = (page - 1) * perPage;
              const include = parseIncludeParam(model, req.query.include);

              let query = repo.query();
              let countQuery = repo.query();
              ({ query, countQuery } = applySoftDeleteScope(query, countQuery, model, req.query.trashed));
              ({ query, countQuery } = applyColumnFilters(query, countQuery, model, req));

              const sortCol = req.query.sort && model.columns.has(req.query.sort) ? req.query.sort : model.primaryKey;
              const order = String(req.query.order || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

              const total = await countQuery.count();
              let listQ = query.orderBy(sortCol, order).offset(offset).limit(perPage);
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
              const include = parseIncludeParam(model, req.query.include);
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
module.exports.sanitizeRecordTree = sanitizeRecordTree;
module.exports.pickWritableColumns = pickWritableColumns;
module.exports.resolveExposedModels = resolveExposedModels;

/**
 * Resolve which records to export (same semantics as admin export handler).
 * @module plugins/data-exchange/record-selection
 */

const { buildFilteredQuery } = require('../admin-panel/core/api-extensions');

/**
 * @param {import('../../core/orm/database').Database} db
 * @param {string} modelName
 * @param {import('express').Request} req
 * @returns {Promise<{ model?: import('../../core/orm/types').ModelDefinition, records?: object[], error?: number, message?: string }>}
 */
async function resolveExportRecords(db, modelName, req) {
  const body = req.body || {};
  let selectAll = body.selectAll ?? req.query.selectAll;
  let filters = body.filters ?? req.query.filters;
  if (typeof selectAll === 'string') selectAll = selectAll === 'true';
  if (typeof filters === 'string') {
    try {
      filters = JSON.parse(filters);
    } catch {
      filters = undefined;
    }
  }

  const trashedOnly =
    body.trashed === 'only' ||
    req.query.trashed === 'only';

  let idList = null;
  if (req.body?.ids && Array.isArray(req.body.ids)) {
    idList = req.body.ids;
  } else if (req.query.ids) {
    idList = String(req.query.ids).split(',').filter(Boolean);
  }

  if (!modelName) {
    return { error: 400, message: 'Model name is required' };
  }

  const { getModel } = require('../../core/orm/model');
  const model = db.getModel ? db.getModel(modelName) : getModel(modelName);

  if (!model || !model.admin?.enabled) {
    return { error: 404, message: 'Model not found or not enabled' };
  }

  const repo = db.getRepository(model.name);
  let records;

  const filterOpts =
    trashedOnly && model.scopes?.softDelete ? { onlyTrashed: true } : {};

  if (selectAll) {
    const query = buildFilteredQuery(repo, filters, filterOpts);
    records = await query.list();
  } else if (idList && idList.length > 0) {
    if (trashedOnly && model.scopes?.softDelete) {
      const pk = model.primaryKey || 'id';
      records = await repo
        .query()
        .onlyTrashed()
        .whereIn(pk, idList)
        .list();
    } else {
      records = [];
      for (const id of idList) {
        const record = await repo.findById(id);
        if (record) records.push(record);
      }
    }
  } else {
    records = await repo.findAll();
  }

  return { model, records };
}

module.exports = { resolveExportRecords };

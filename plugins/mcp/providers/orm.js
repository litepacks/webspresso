/**
 * Webspresso MCP ORM Provider
 * Bridges Webspresso ORM models to MCP Tools and Resources
 * @module plugins/mcp/providers/orm
 */

const { getAllModels } = require('../../../core/orm/model');
const { convertZodToInputSchema } = require('./services');

/**
 * Describe a model's schema, columns, and relations
 * @param {import('../../../core/orm/types').ModelDefinition} model
 * @returns {Object}
 */
function describeModel(model) {
  if (!model) return null;

  const columns = {};
  if (model.columns instanceof Map) {
    for (const [colName, colMeta] of model.columns.entries()) {
      columns[colName] = {
        type: colMeta.type || 'unknown',
        nullable: Boolean(colMeta.nullable),
        primaryKey: Boolean(colMeta.primaryKey),
        unique: Boolean(colMeta.unique),
        default: colMeta.default,
      };
    }
  }

  // Also extract fields from schema shape if available
  if (model.schema && model.schema.shape) {
    for (const [key, val] of Object.entries(model.schema.shape)) {
      if (!columns[key]) {
        columns[key] = {
          type: val._def?.typeName?.replace(/^Zod/, '').toLowerCase() || 'unknown',
          nullable: val.isNullable ? val.isNullable() : false,
          optional: val.isOptional ? val.isOptional() : false,
        };
      }
    }
  }

  const relations = {};
  if (model.relations) {
    for (const [relName, relMeta] of Object.entries(model.relations)) {
      let targetName = relMeta.targetModel;
      if (!targetName && typeof relMeta.model === 'function') {
        try {
          const res = relMeta.model();
          targetName = typeof res === 'string' ? res : res?.name;
        } catch (e) {}
      }
      relations[relName] = {
        type: relMeta.type,
        targetModel: targetName,
        foreignKey: relMeta.foreignKey,
      };
    }
  }

  return {
    name: model.name,
    table: model.table,
    primaryKey: model.primaryKey || 'id',
    columns,
    relations,
    hidden: model.hidden || [],
    softDelete: Boolean(model.softDelete),
    admin: model.admin || null,
  };
}

/**
 * Creates ORM-related MCP tools
 * @param {Object} options
 * @param {Object} options.db - Webspresso database instance
 * @param {boolean} [options.readOnly=false]
 * @param {Array<string>} [options.models] - Whitelist of model names
 * @returns {Array<Object>}
 */
function createOrmTools(options = {}) {
  const { db, readOnly = false, models: modelWhitelist } = options;
  if (!db) return [];

  const tools = [
    {
      name: 'orm_describe_model',
      description: 'Get detailed metadata, columns, types, relations, and settings for a given ORM model.',
      inputSchema: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            description: 'Name of the model (e.g. "User", "Product")',
          },
        },
        required: ['model'],
      },
      handler: async ({ model }) => {
        const modelDef = db.getModel ? db.getModel(model) : null;
        if (!modelDef) {
          throw new Error(`Model "${model}" not found in registered database models.`);
        }
        return describeModel(modelDef);
      },
    },
    {
      name: 'orm_find',
      description: 'Query records from an ORM model using where filters, pagination, and sorting.',
      inputSchema: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Model name' },
          where: { type: 'object', description: 'Filter key-value pairs (e.g. {"status": "active"})' },
          limit: { type: 'number', description: 'Maximum number of records (default: 20, max: 100)' },
          page: { type: 'number', description: 'Page number (default: 1)' },
          sort: { type: 'string', description: 'Column to sort by' },
          order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort order' },
        },
        required: ['model'],
      },
      handler: async ({ model, where = {}, limit = 20, page = 1, sort, order = 'asc' }) => {
        const repo = db.getRepository(model);
        if (!repo) {
          throw new Error(`Repository for model "${model}" not found.`);
        }

        const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
        const safePage = Math.max(1, Number(page) || 1);

        let query = repo.query();
        if (where && typeof where === 'object') {
          for (const [k, v] of Object.entries(where)) {
            if (v !== undefined) {
              query = query.where(k, v);
            }
          }
        }

        if (sort) {
          query = query.orderBy(sort, order);
        }

        const result = await query.paginate({ page: safePage, limit: safeLimit });
        return result;
      },
    },
    {
      name: 'orm_findById',
      description: 'Fetch a single record by primary key ID from an ORM model.',
      inputSchema: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Model name' },
          id: { description: 'Record primary key ID' },
        },
        required: ['model', 'id'],
      },
      handler: async ({ model, id }) => {
        const repo = db.getRepository(model);
        if (!repo) {
          throw new Error(`Repository for model "${model}" not found.`);
        }
        const record = await repo.findById(id);
        if (!record) {
          return { found: false, record: null };
        }
        return { found: true, record };
      },
    },
  ];

  // If not readOnly, add mutation tools
  if (!readOnly) {
    tools.push(
      {
        name: 'orm_create',
        description: 'Create a new record for a given ORM model with schema validation and lifecycle hooks.',
        inputSchema: {
          type: 'object',
          properties: {
            model: { type: 'string', description: 'Model name' },
            data: { type: 'object', description: 'Record fields to insert' },
          },
          required: ['model', 'data'],
        },
        handler: async ({ model, data }) => {
          const repo = db.getRepository(model);
          if (!repo) {
            throw new Error(`Repository for model "${model}" not found.`);
          }
          const created = await repo.create(data);
          return { success: true, record: created };
        },
      },
      {
        name: 'orm_update',
        description: 'Update an existing record by ID in an ORM model.',
        inputSchema: {
          type: 'object',
          properties: {
            model: { type: 'string', description: 'Model name' },
            id: { description: 'Record ID to update' },
            data: { type: 'object', description: 'Fields to update' },
          },
          required: ['model', 'id', 'data'],
        },
        handler: async ({ model, id, data }) => {
          const repo = db.getRepository(model);
          if (!repo) {
            throw new Error(`Repository for model "${model}" not found.`);
          }
          const updated = await repo.update(id, data);
          return { success: Boolean(updated), record: updated };
        },
      },
      {
        name: 'orm_delete',
        description: 'Delete a record by ID from an ORM model (respects soft deletes if configured).',
        inputSchema: {
          type: 'object',
          properties: {
            model: { type: 'string', description: 'Model name' },
            id: { description: 'Record ID to delete' },
          },
          required: ['model', 'id'],
        },
        handler: async ({ model, id }) => {
          const repo = db.getRepository(model);
          if (!repo) {
            throw new Error(`Repository for model "${model}" not found.`);
          }
          const ok = await repo.delete(id);
          return { success: Boolean(ok) };
        },
      }
    );
  }

  // Whitelist filtering if specified
  if (modelWhitelist && modelWhitelist.length > 0) {
    const allowed = new Set(modelWhitelist);
    return tools.map((t) => ({
      ...t,
      handler: async (args, ctx) => {
        if (args.model && !allowed.has(args.model)) {
          throw new Error(`Access to model "${args.model}" is not permitted.`);
        }
        return t.handler(args, ctx);
      },
    }));
  }

  return tools;
}

/**
 * Creates ORM-related MCP resources and templates
 * @param {Object} options
 * @param {Object} options.db
 * @returns {{ resources: Array<Object>, templates: Array<Object> }}
 */
function createOrmResources(options = {}) {
  const { db } = options;
  if (!db) return { resources: [], templates: [] };

  const resources = [
    {
      uri: 'webspresso://models',
      name: 'Registered ORM Models',
      description: 'List of all database models registered in Webspresso.',
      mimeType: 'application/json',
      handler: async () => {
        const models = getAllModels ? getAllModels() : [];
        const modelList = models instanceof Map ? Array.from(models.values()) : (Array.isArray(models) ? models : Object.values(models));
        return modelList.map((m) => ({
          name: m.name,
          table: m.table,
          softDelete: Boolean(m.softDelete),
          primaryKey: m.primaryKey || 'id',
        }));
      },
    },
    {
      uri: 'webspresso://schema',
      name: 'Database Schema Overview',
      description: 'Complete database models schema structure with columns, types, and relations.',
      mimeType: 'application/json',
      handler: async () => {
        const models = getAllModels ? getAllModels() : [];
        const modelList = models instanceof Map ? Array.from(models.values()) : (Array.isArray(models) ? models : Object.values(models));
        const result = {};
        for (const model of modelList) {
          result[model.name] = describeModel(model);
        }
        return result;
      },
    },
  ];

  const templates = [
    {
      uriTemplate: 'webspresso://models/{model}',
      name: 'ORM Model Metadata',
      description: 'Get full schema and relationship definition for a specific model.',
      mimeType: 'application/json',
      handler: async (uri, params) => {
        const modelDef = db.getModel ? db.getModel(params.model) : null;
        if (!modelDef) {
          throw new Error(`Model "${params.model}" not found.`);
        }
        return describeModel(modelDef);
      },
    },
  ];

  return { resources, templates };
}

module.exports = {
  createOrmTools,
  createOrmResources,
  describeModel,
};

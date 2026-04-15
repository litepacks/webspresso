/**
 * Schema Explorer Plugin
 * Exposes ORM model metadata via API endpoint
 * Useful for documentation, admin tools, and frontend code generation
 */

const { getAllModels, getModel } = require('../core/orm/model');
const { getColumnMeta } = require('../core/orm/schema-helpers');
const { generateOrmOpenApiSchemas } = require('../core/openapi/orm-components');

/**
 * Create Schema Explorer plugin
 * @param {Object} options - Plugin options
 * @param {string} [options.path='/_schema'] - API endpoint path
 * @param {boolean} [options.enabled] - Force enable/disable (default: auto based on NODE_ENV)
 * @param {string[]} [options.exclude=[]] - Model names to exclude
 * @param {boolean} [options.includeColumns=true] - Include column metadata
 * @param {boolean} [options.includeRelations=true] - Include relation metadata
 * @param {boolean} [options.includeScopes=true] - Include scope configuration
 * @param {Function} [options.authorize] - Custom authorization function (req) => boolean
 * @returns {Object} Plugin definition
 */
function schemaExplorerPlugin(options = {}) {
  const {
    path = '/_schema',
    enabled,
    exclude = [],
    includeColumns = true,
    includeRelations = true,
    includeScopes = true,
    authorize,
  } = options;

  return {
    name: 'schema-explorer',
    version: '1.0.0',

    // Expose API for other plugins
    api: {
      /**
       * Get all models metadata
       * @returns {Object[]}
       */
      getModels() {
        return serializeAllModels({ exclude, includeColumns, includeRelations, includeScopes });
      },

      /**
       * Get single model metadata
       * @param {string} name - Model name
       * @returns {Object|null}
       */
      getModel(name) {
        const model = getModel(name);
        if (!model || exclude.includes(name)) return null;
        return serializeModel(model, { includeColumns, includeRelations, includeScopes });
      },

      /**
       * Get model names
       * @returns {string[]}
       */
      getModelNames() {
        const models = getAllModels();
        return [...models.keys()].filter(name => !exclude.includes(name));
      },
    },

    onRoutesReady(ctx) {
      const isDev = process.env.NODE_ENV !== 'production';
      const isEnabled = enabled !== undefined ? enabled : isDev;

      if (!isEnabled) {
        return;
      }

      // List all models
      ctx.addRoute('get', path, (req, res) => {
        // Check authorization
        if (authorize && !authorize(req)) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const models = serializeAllModels({ exclude, includeColumns, includeRelations, includeScopes });

        res.json({
          meta: {
            version: '1.0.0',
            generatedAt: new Date().toISOString(),
            modelCount: models.length,
          },
          models,
        });
      });

      // OpenAPI/JSON Schema export (must be registered before :modelName route)
      ctx.addRoute('get', `${path}/openapi`, (req, res) => {
        // Check authorization
        if (authorize && !authorize(req)) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const openApiSchemas = generateOrmOpenApiSchemas({ exclude });

        res.json({
          openapi: '3.0.0',
          info: {
            title: 'Database Schema',
            version: '1.0.0',
          },
          components: {
            schemas: openApiSchemas,
          },
        });
      });

      // Get single model by name (must be after /openapi to avoid matching "openapi" as modelName)
      ctx.addRoute('get', `${path}/:modelName`, (req, res) => {
        // Check authorization
        if (authorize && !authorize(req)) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const { modelName } = req.params;
        const model = getModel(modelName);

        if (!model || exclude.includes(modelName)) {
          return res.status(404).json({ error: `Model "${modelName}" not found` });
        }

        res.json({
          meta: {
            version: '1.0.0',
            generatedAt: new Date().toISOString(),
          },
          model: serializeModel(model, { includeColumns, includeRelations, includeScopes }),
        });
      });

      if (isDev) {
        console.log(`  📋 Schema Explorer: ${path}`);
      }
    },
  };
}

/**
 * Serialize all models
 * @param {Object} options
 * @returns {Object[]}
 */
function serializeAllModels(options) {
  const { exclude, includeColumns, includeRelations, includeScopes } = options;
  const models = getAllModels();
  const result = [];

  for (const [name, model] of models) {
    if (exclude.includes(name)) continue;
    result.push(serializeModel(model, { includeColumns, includeRelations, includeScopes }));
  }

  // Sort by name
  result.sort((a, b) => a.name.localeCompare(b.name));

  return result;
}

/**
 * Serialize a single model
 * @param {Object} model - Model definition
 * @param {Object} options
 * @returns {Object}
 */
function serializeModel(model, options) {
  const { includeColumns, includeRelations, includeScopes } = options;

  const serialized = {
    name: model.name,
    table: model.table,
    primaryKey: model.primaryKey,
  };

  // Include columns
  if (includeColumns && model.columns) {
    serialized.columns = serializeColumns(model.columns);
  }

  // Include relations
  if (includeRelations && model.relations) {
    serialized.relations = serializeRelations(model.relations);
  }

  // Include scopes
  if (includeScopes && model.scopes) {
    serialized.scopes = {
      softDelete: model.scopes.softDelete || false,
      timestamps: model.scopes.timestamps || false,
      tenant: model.scopes.tenant || null,
    };
  }

  return serialized;
}

/**
 * Serialize column metadata
 * @param {Map} columns - Columns map
 * @returns {Object[]}
 */
function serializeColumns(columns) {
  const result = [];

  for (const [name, meta] of columns) {
    result.push({
      name,
      type: meta.type,
      nullable: meta.nullable || false,
      primary: meta.primary || false,
      autoIncrement: meta.autoIncrement || false,
      unique: meta.unique || false,
      index: meta.index || false,
      default: meta.default,
      maxLength: meta.maxLength,
      precision: meta.precision,
      scale: meta.scale,
      enumValues: meta.enumValues,
      references: meta.references,
      referenceColumn: meta.referenceColumn,
      auto: meta.auto,
    });
  }

  return result;
}

/**
 * Serialize relation metadata
 * @param {Object} relations - Relations object
 * @returns {Object[]}
 */
function serializeRelations(relations) {
  const result = [];

  for (const [name, relation] of Object.entries(relations)) {
    // Resolve the model to get its name
    let relatedModelName = null;
    try {
      const relatedModel = relation.model();
      relatedModelName = relatedModel?.name || null;
    } catch {
      // Model not yet defined
    }

    result.push({
      name,
      type: relation.type,
      relatedModel: relatedModelName,
      foreignKey: relation.foreignKey,
      localKey: relation.localKey || 'id',
    });
  }

  return result;
}

module.exports = schemaExplorerPlugin;


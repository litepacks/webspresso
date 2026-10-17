/**
 * Schema Explorer Plugin
 * Exposes ORM model metadata via API endpoint and interactive Admin Panel SPA page.
 * Useful for documentation, database architecture visualization, ER diagrams, and admin tools.
 */

'use strict';

const { getAllModels, getModel } = require('../core/orm/model');
const { getColumnMeta } = require('../core/orm/schema-helpers');
const { generateOrmOpenApiSchemas } = require('../core/openapi/orm-components');
const {
  extractAllRelationships,
  enrichModelsWithGraph,
  generateMermaidErDiagram,
} = require('./schema-explorer/relations-graph');
const {
  generateSchemaExplorerAdminComponent,
} = require('./schema-explorer/admin-component');

/**
 * Create Schema Explorer plugin
 * @param {Object} [options] - Plugin options
 * @param {string} [options.path='/_schema'] - Raw API endpoint path
 * @param {boolean} [options.enabled] - Force enable/disable raw API (default: auto based on NODE_ENV)
 * @param {string[]} [options.exclude=[]] - Model names to exclude
 * @param {boolean} [options.includeColumns=true] - Include column metadata
 * @param {boolean} [options.includeRelations=true] - Include relation metadata
 * @param {boolean} [options.includeScopes=true] - Include scope configuration
 * @param {Function} [options.authorize] - Custom authorization function (req) => boolean
 * @param {boolean} [options.admin=true] - Enable Admin Panel module when admin-panel plugin is present
 * @param {string} [options.title] - Admin page title (default: menuLabel or 'Schema Explorer')
 * @param {string} [options.adminTitle] - Admin page title alias
 * @param {string} [options.adminPath='/schema'] - Path within admin panel
 * @param {string} [options.menuLabel='Schema Explorer'] - Admin sidebar menu label
 * @param {string} [options.menuIcon='database'] - Admin sidebar icon
 * @param {number} [options.menuOrder=85] - Admin sidebar menu order
 * @param {string} [options.apiPrefix='/schema'] - Admin API prefix under /_admin/api
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
    admin = true,
    adminPath = '/schema',
    title,
    adminTitle,
    menuLabel = 'Schema Explorer',
    menuIcon = 'database',
    menuOrder = 85,
    apiPrefix = '/schema',
  } = options;

  const pageTitle = title || adminTitle || menuLabel;

  let cachedGraph = null;
  let cachedGraphTime = 0;
  const GRAPH_CACHE_TTL = 5000; // 5 seconds in dev, infinite in prod

  function getEnrichedGraph() {
    const isProd = process.env.NODE_ENV === 'production';
    const now = Date.now();
    if (cachedGraph && (isProd || (now - cachedGraphTime) < GRAPH_CACHE_TTL)) {
      return cachedGraph;
    }
    const rawModels = serializeAllModels({ exclude, includeColumns, includeRelations, includeScopes });
    const relationships = extractAllRelationships(rawModels);
    const enriched = enrichModelsWithGraph(rawModels, relationships);
    const mermaid = generateMermaidErDiagram(rawModels, relationships);
    cachedGraph = { rawModels, relationships, enriched, mermaid };
    cachedGraphTime = now;
    return cachedGraph;
  }

  return {
    name: 'schema-explorer',
    version: '1.0.0',
    description: 'Database schema, ER diagram & relation explorer for API and Admin Panel',

    // Expose API for other plugins & programmatic consumption
    api: {
      /**
       * Invalidate schema explorer cache
       */
      invalidateCache() {
        cachedGraph = null;
        cachedGraphTime = 0;
      },

      /**
       * Get all models metadata
       * @returns {Object[]}
       */
      getModels() {
        return serializeAllModels({ exclude, includeColumns, includeRelations, includeScopes });
      },

      /**
       * Get all models enriched with incoming/outgoing relationships graph
       * @returns {Object[]}
       */
      getEnrichedModels() {
        return getEnrichedGraph().enriched;
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

      /**
       * Get unified relationships graph
       * @returns {Object[]}
       */
      getRelationships() {
        return getEnrichedGraph().relationships;
      },

      /**
       * Generate Mermaid ER diagram syntax
       * @returns {string}
       */
      getMermaid() {
        return getEnrichedGraph().mermaid;
      },

      extractAllRelationships,
      enrichModelsWithGraph,
      generateMermaidErDiagram,
    },

    onRoutesReady(ctx) {
      const isDev = process.env.NODE_ENV !== 'production';
      const isRawEnabled = enabled !== undefined ? enabled : isDev;

      // 1. Raw API Endpoints (if enabled or dev mode)
      if (isRawEnabled) {
        // List all models with schema metadata
        ctx.addRoute('get', path, (req, res) => {
          if (authorize && !authorize(req)) {
            return res.status(403).json({ error: 'Forbidden' });
          }

          const rawModels = serializeAllModels({ exclude, includeColumns, includeRelations, includeScopes });
          const relationships = extractAllRelationships(rawModels);
          const models = enrichModelsWithGraph(rawModels, relationships);

          res.json({
            meta: {
              version: '1.0.0',
              generatedAt: new Date().toISOString(),
              modelCount: models.length,
              relationCount: relationships.length,
            },
            models,
            relationships,
          });
        });

        // OpenAPI/JSON Schema export (must be registered before :modelName route)
        ctx.addRoute('get', `${path}/openapi`, (req, res) => {
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

        // Mermaid ER Diagram export
        ctx.addRoute('get', `${path}/mermaid`, (req, res) => {
          if (authorize && !authorize(req)) {
            return res.status(403).json({ error: 'Forbidden' });
          }

          const rawModels = serializeAllModels({ exclude, includeColumns, includeRelations, includeScopes });
          const relationships = extractAllRelationships(rawModels);
          const mermaid = generateMermaidErDiagram(rawModels, relationships);

          if (req.accepts('text/plain') && !req.accepts('json')) {
            res.type('text/plain').send(mermaid);
          } else {
            res.json({ mermaid });
          }
        });

        // Get single model by name
        ctx.addRoute('get', `${path}/:modelName`, (req, res) => {
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
          console.log(`  📋 Schema Explorer API: ${path}`);
        }
      }

      // 2. Admin Panel Integration (when adminPanelPlugin is present and admin !== false)
      if (admin !== false && typeof ctx.usePlugin === 'function') {
        const adminApi = ctx.usePlugin('admin-panel');
        if (adminApi) {
          const normAdminPath = adminPath.startsWith('/') ? adminPath : '/' + adminPath;

          adminApi.registerModule({
            id: 'schema-explorer',
            title: pageTitle,
            pages: [{
              id: 'schema-explorer',
              title: pageTitle,
              path: normAdminPath,
              icon: menuIcon,
              component: generateSchemaExplorerAdminComponent({ apiPrefix }),
            }],
            menu: [{
              id: 'schema-explorer',
              label: menuLabel,
              path: normAdminPath,
              icon: menuIcon,
              order: menuOrder,
            }],
            api: {
              prefix: apiPrefix,
              routes: [
                {
                  method: 'get',
                  path: '',
                  handler: (req, res) => {
                    const graph = getEnrichedGraph();
                    res.json({
                      meta: {
                        version: '1.0.0',
                        generatedAt: new Date().toISOString(),
                        modelCount: graph.enriched.length,
                        relationCount: graph.relationships.length,
                      },
                      models: graph.enriched,
                      relationships: graph.relationships,
                      mermaid: graph.mermaid,
                    });
                  },
                },
                {
                  method: 'get',
                  path: '/relations',
                  handler: (req, res) => {
                    res.json({ relationships: getEnrichedGraph().relationships });
                  },
                },
                {
                  method: 'get',
                  path: '/mermaid',
                  handler: (req, res) => {
                    res.json({ mermaid: getEnrichedGraph().mermaid });
                  },
                },
                {
                  method: 'get',
                  path: '/models/:modelName',
                  handler: (req, res) => {
                    const { modelName } = req.params;
                    const model = getModel(modelName);

                    if (!model || exclude.includes(modelName)) {
                      return res.status(404).json({ error: `Model "${modelName}" not found` });
                    }

                    const graph = getEnrichedGraph();
                    const found = graph.enriched.find(m => m.name === modelName);

                    res.json({ model: found });
                  },
                },
              ],
            },
          });

          if (isDev) {
            console.log(`  🗄️ Schema Explorer Admin: ${adminApi.getAdminPath ? adminApi.getAdminPath() : '/_admin'}${normAdminPath}`);
          }
        }
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
module.exports.schemaExplorerPlugin = schemaExplorerPlugin;
module.exports.extractAllRelationships = extractAllRelationships;
module.exports.enrichModelsWithGraph = enrichModelsWithGraph;
module.exports.generateMermaidErDiagram = generateMermaidErDiagram;
module.exports.generateSchemaExplorerAdminComponent = generateSchemaExplorerAdminComponent;

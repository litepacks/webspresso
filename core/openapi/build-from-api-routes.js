/**
 * Build OpenAPI 3 document from file-router API route metadata + Zod schemas
 */

const fs = require('fs');
const path = require('path');
const { zodToJsonSchema } = require('zod-to-json-schema');
const { compileSchema } = require('../compileSchema');
const { generateOrmOpenApiSchemas } = require('./orm-components');

/**
 * Express route pattern → OpenAPI path (e.g. /users/:id → /users/{id})
 * @param {string} expressPath
 * @returns {string}
 */
function expressPathToOpenApi(expressPath) {
  return String(expressPath)
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}')
    .replace(/\*/g, '{wildcard}');
}

/**
 * @param {import('zod').ZodObject<any>} zodObj
 * @param {'path' | 'query'} where
 * @returns {object[]}
 */
function expandZodObjectToParameters(zodObj, where) {
  if (!zodObj || zodObj._def?.typeName !== 'ZodObject') return [];
  const shape = zodObj.shape;
  return Object.entries(shape).map(([name, zType]) => ({
    name,
    in: where,
    required: where === 'path' ? true : !zType.isOptional(),
    schema: zodToJsonSchema(zType, { target: 'openApi3', $refStrategy: 'none' }),
  }));
}

/**
 * @param {object} route - { type, method, pattern, file }
 * @param {object|null} compiled - compileSchema result
 * @returns {object} OpenAPI Operation Object
 */
function buildOperation(route, compiled) {
  const filePath = route.file;
  const method = route.method.toLowerCase();
  const summary = `${method.toUpperCase()} ${filePath}`;

  const op = {
    tags: ['api'],
    summary,
    operationId: String(filePath)
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_|_$/g, ''),
    responses: {
      200: {
        description: 'OK',
      },
    },
  };

  if (compiled?.response) {
    op.responses['200'] = {
      description: 'OK',
      content: {
        'application/json': {
          schema: zodToJsonSchema(compiled.response, { target: 'openApi3', $refStrategy: 'none' }),
        },
      },
    };
  }

  const parameters = [
    ...expandZodObjectToParameters(compiled?.params, 'path'),
    ...expandZodObjectToParameters(compiled?.query, 'query'),
  ];

  if (parameters.length) {
    op.parameters = parameters;
  }

  if (compiled?.body) {
    op.requestBody = {
      content: {
        'application/json': {
          schema: zodToJsonSchema(compiled.body, { target: 'openApi3', $refStrategy: 'none' }),
        },
      },
    };
  }

  return op;
}

/**
 * @param {object} opts
 * @param {object[]} opts.routes - route metadata from mountPages
 * @param {string} opts.pagesDir
 * @param {boolean} [opts.includeOrmSchemas]
 * @param {string[]} [opts.ormExclude]
 * @param {object} [opts.info]
 * @param {object[]} [opts.servers]
 * @returns {object} OpenAPI 3.0.x document
 */
function buildOpenApiDocument(opts) {
  const {
    routes = [],
    pagesDir,
    includeOrmSchemas = false,
    ormExclude = [],
    info = {},
    servers = [{ url: '/' }],
  } = opts;

  if (!pagesDir) {
    throw new Error('buildOpenApiDocument: pagesDir is required');
  }

  const paths = {};
  const apiRoutes = routes.filter((r) => r.type === 'api');
  const absPages = path.resolve(pagesDir);

  for (const route of apiRoutes) {
    const fullPath = path.join(absPages, route.file);
    if (!fs.existsSync(fullPath)) {
      continue;
    }

    let mod;
    try {
      mod = require(fullPath);
    } catch {
      continue;
    }

    let compiled = null;
    try {
      compiled = compileSchema(fullPath, mod);
    } catch {
      compiled = null;
    }

    const openApiPath = expressPathToOpenApi(route.pattern);
    const method = route.method.toLowerCase();

    if (!paths[openApiPath]) {
      paths[openApiPath] = {};
    }

    paths[openApiPath][method] = buildOperation(route, compiled);
  }

  const doc = {
    openapi: '3.0.3',
    info: {
      title: info.title || 'API',
      version: info.version || '1.0.0',
      ...(info.description ? { description: info.description } : {}),
    },
    servers,
    paths,
    components: {
      schemas: includeOrmSchemas ? generateOrmOpenApiSchemas({ exclude: ormExclude }) : {},
    },
  };

  return doc;
}

module.exports = {
  expressPathToOpenApi,
  buildOpenApiDocument,
};

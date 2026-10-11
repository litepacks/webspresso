'use strict';

/**
 * Build OpenAPI 3 document from file-router API route metadata + Zod schemas
 * @module core/openapi/build-from-api-routes
 */

const fs = require('fs');
const path = require('path');
const { zodToJsonSchema } = require('zod-to-json-schema');
const { compileSchema } = require('../compileSchema');
const { generateOrmOpenApiSchemas } = require('./orm-components');

const OPENAPI_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

/**
 * Express route pattern → OpenAPI path (e.g. /users/:id → /users/{id})
 * @param {string} expressPath
 * @returns {string}
 */
function expressPathToOpenApi(expressPath) {
  if (!expressPath) return '';
  return String(expressPath)
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}')
    .replace(/\[([A-Za-z0-9_]+)\]/g, '{$1}')
    .replace(/\*/g, '{wildcard}');
}

/**
 * Resolves the physical file path of an API route descriptor
 * @param {Object} route
 * @param {string} [pagesDir]
 * @returns {string|null}
 */
function resolveRouteFilePath(route, pagesDir) {
  const rawFile = route.file || route.source;
  if (!rawFile) return null;

  if (path.isAbsolute(rawFile) && fs.existsSync(rawFile)) {
    return rawFile;
  }

  const fromCwd = path.resolve(process.cwd(), rawFile);
  if (fs.existsSync(fromCwd)) {
    return fromCwd;
  }

  if (pagesDir) {
    const fromPages = path.join(path.resolve(pagesDir), rawFile);
    if (fs.existsSync(fromPages)) {
      return fromPages;
    }
  }

  return null;
}

/**
 * Infers an expressive operation summary from HTTP method and path
 * @param {string} method
 * @param {string} routePath
 * @returns {string}
 */
function inferOperationSummary(method, routePath) {
  const clean = String(routePath || '').replace(/^\/api\/?/, '').replace(/\/$/, '');
  const segments = clean.split('/').filter(Boolean);
  const lastSeg = segments[segments.length - 1] || 'root';
  const isParam = lastSeg.startsWith(':') || (lastSeg.startsWith('{') && lastSeg.endsWith('}')) || (lastSeg.startsWith('[') && lastSeg.endsWith(']'));
  const resource = isParam && segments.length > 1 ? segments[segments.length - 2] : lastSeg;
  const m = String(method || 'GET').toUpperCase();

  if (m === 'GET') {
    return isParam ? `Get ${resource} by ID` : `List ${resource}`;
  }
  if (m === 'POST') return `Create ${resource}`;
  if (m === 'PUT' || m === 'PATCH') return `Update ${resource}`;
  if (m === 'DELETE') return `Delete ${resource}`;
  return `${m} /api/${clean}`;
}

/**
 * Infers tag category from route path segments
 * @param {string} routePath
 * @param {string[]} [explicitTags]
 * @returns {string[]}
 */
function inferOperationTags(routePath, explicitTags) {
  if (Array.isArray(explicitTags) && explicitTags.length > 0) return explicitTags;
  const clean = String(routePath || '').replace(/^\/api\/?/, '').replace(/\/$/, '');
  const firstSeg = clean.split('/').filter(Boolean)[0];
  if (firstSeg && !firstSeg.startsWith(':') && !firstSeg.startsWith('{') && !firstSeg.startsWith('[')) {
    return [firstSeg];
  }
  return ['api'];
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
 * @param {object} route - { type, method, pattern, path, file }
 * @param {object|null} compiled - compileSchema result
 * @param {object|null} [mod] - Raw route module
 * @returns {object} OpenAPI Operation Object
 */
function buildOperation(route, compiled, mod = null) {
  const filePath = route.file || route.source || '';
  const method = (route.method || 'GET').toLowerCase();
  const routePath = route.path || route.pattern || filePath;

  let summary = (mod && (mod.summary || mod.openapi?.summary)) || route.summary;
  if (!summary) {
    if (filePath) {
      summary = `${method.toUpperCase()} ${filePath}`;
    } else {
      summary = inferOperationSummary(method, routePath);
    }
  }

  const tags = inferOperationTags(routePath, (mod && (mod.tags || mod.openapi?.tags)) || route.tags);

  const op = {
    tags,
    summary,
    operationId: String(filePath || routePath)
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_|_$/g, ''),
    responses: {
      200: {
        description: 'OK',
      },
    },
  };

  if (mod && mod.description) {
    op.description = mod.description;
  }

  // Auth / Security detection
  const middlewares = Array.isArray(route.middleware)
    ? route.middleware
    : (Array.isArray(mod?.middleware) ? mod.middleware : []);
  const security = [];
  if (middlewares.includes('jwt') || middlewares.includes('bearer')) {
    security.push({ bearerAuth: [] });
  }
  if (middlewares.includes('auth') || middlewares.includes('session')) {
    security.push({ sessionAuth: [] });
  }
  if (security.length > 0) {
    op.security = security;
  }

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
 * Builds an OpenAPI 3.0 document from application routes and ORM components
 * @param {object} opts
 * @param {object[]} opts.routes - Route metadata array
 * @param {string} opts.pagesDir - Pages directory path
 * @param {boolean} [opts.includeOrmSchemas=false]
 * @param {string[]} [opts.ormExclude=[]]
 * @param {object} [opts.info]
 * @param {object[]} [opts.servers]
 * @returns {object} OpenAPI 3.0.x document
 */
function buildOpenApiDocument(opts = {}) {
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

  const paths = Object.create(null);
  const apiRoutes = routes.filter((r) => r.type === 'api' || (r.path && r.path.startsWith('/api')));

  for (const route of apiRoutes) {
    const fullPath = resolveRouteFilePath(route, pagesDir);

    if (route.file && !fullPath) {
      continue;
    }

    let mod = null;
    let compiled = null;

    if (fullPath) {
      try {
        mod = require(fullPath);
      } catch {
        mod = null;
      }

      if (mod) {
        try {
          compiled = compileSchema(fullPath, mod);
        } catch {
          compiled = null;
        }
      }
    }

    const routePattern = route.path || route.pattern || '';
    if (!routePattern) continue;

    const openApiPath = expressPathToOpenApi(routePattern);
    const method = (route.method || 'GET').toLowerCase();

    if (!OPENAPI_METHODS.has(method)) {
      continue;
    }

    if (!paths[openApiPath]) {
      paths[openApiPath] = Object.create(null);
    }

    paths[openApiPath][method] = buildOperation(route, compiled, mod);
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
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Stateless JWT Bearer token authentication',
        },
        sessionAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'connect.sid',
          description: 'Session cookie authentication',
        },
      },
      schemas: includeOrmSchemas ? generateOrmOpenApiSchemas({ exclude: ormExclude }) : {},
    },
  };

  return doc;
}

module.exports = {
  expressPathToOpenApi,
  resolveRouteFilePath,
  inferOperationSummary,
  inferOperationTags,
  buildOperation,
  buildOpenApiDocument,
};

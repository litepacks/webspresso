'use strict';

/**
 * Webspresso Type-Safe Frontend Client Generator
 * Generates an end-to-end typed TypeScript HTTP client from API routes and Zod schemas
 * @module src/dev/client-gen
 */

const fs = require('fs');
const path = require('path');
const { scanRoutes } = require('../discovery/scan-routes');
const { zodToTsType } = require('./typegen');
const { z } = require('../../core/validation');

/**
 * Normalizes a URL path into clean segments, stripping /api prefix if desired
 * @param {string} routePattern e.g. "/api/notes/:id"
 * @returns {string[]} e.g. ['api', 'notes', ':id']
 */
function pathToSegments(routePattern) {
  return routePattern
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);
}

/**
 * Inspects a route file and extracts schemas
 * @param {string} filePath
 * @returns {{ bodyType: string, queryType: string, paramsType: string, responseType: string }}
 */
function extractRouteTypes(filePath) {
  let bodyType = 'unknown';
  let queryType = 'Record<string, unknown>';
  let paramsType = 'Record<string, string>';
  let responseType = 'any';

  try {
    const fullPath = path.resolve(filePath);
    if (!fs.existsSync(fullPath)) return { bodyType, queryType, paramsType, responseType };

    delete require.cache[fullPath];
    const mod = require(fullPath);
    const def = mod && mod.default ? mod.default : mod;

    let schema = def && def.schema;
    if (typeof schema === 'function') {
      try {
        schema = schema({ z });
      } catch {
        schema = null;
      }
    }

    if (schema && typeof schema === 'object') {
      if (schema.body && typeof schema.body.parse === 'function') {
        bodyType = zodToTsType(schema.body, 3);
      }
      if (schema.query && typeof schema.query.parse === 'function') {
        queryType = zodToTsType(schema.query, 3);
      }
      if (schema.params && typeof schema.params.parse === 'function') {
        paramsType = zodToTsType(schema.params, 3);
      }
    }

    // Response type from def.response or doc
    if (def && def.response) {
      const resp200 = def.response[200] || def.response['200'] || def.response[201] || def.response['201'];
      if (resp200 && typeof resp200.parse === 'function') {
        responseType = zodToTsType(resp200, 3);
      }
    }
  } catch (_) {}

  return { bodyType, queryType, paramsType, responseType };
}

/**
 * Collects and processes all API routes for client generation
 * @param {string} rootDir
 * @param {string} [pagesRelDir='pages']
 * @returns {Array<Object>}
 */
function collectApiRoutes(rootDir, pagesRelDir = 'pages') {
  const pagesDir = path.resolve(rootDir, pagesRelDir);
  const apiDir = path.join(pagesDir, 'api');
  if (!fs.existsSync(apiDir)) return [];

  let descriptors = [];
  try {
    descriptors = scanRoutes({
      rootDir,
      pages: { dir: pagesRelDir },
      api: { dir: path.join(pagesRelDir, 'api') },
    });
  } catch {
    return [];
  }

  const apiRoutes = descriptors.filter((d) => d.type === 'api' || d.file.includes(`${path.sep}api${path.sep}`));
  const routes = [];

  for (const desc of apiRoutes) {
    const method = (desc.method || 'get').toLowerCase();
    const pattern = desc.pattern || `/api/${path.basename(desc.file, '.js')}`;
    const segments = pathToSegments(pattern);
    const types = extractRouteTypes(desc.file);

    routes.push({
      pattern,
      method,
      segments,
      file: desc.file,
      ...types,
    });
  }

  return routes;
}

/**
 * Builds TypeScript client source code
 * @param {Array<Object>} routes
 * @param {Object} [options]
 * @returns {string}
 */
function generateClientCode(routes = [], options = {}) {
  const timestamp = new Date().toISOString();
  const defaultBaseUrl = options.baseUrl || '';

  let code = `/**
 * Webspresso Auto-Generated Type-Safe Frontend Client
 * Generated on: ${timestamp}
 * DO NOT EDIT DIRECTLY. Regenerate using: npx webspresso client:generate
 */

export interface WebspressoClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  getToken?: () => string | null | Promise<string | null>;
}

export class WebspressoClientError<TData = any> extends Error {
  constructor(
    message: string,
    public status: number,
    public data: TData
  ) {
    super(message);
    this.name = 'WebspressoClientError';
  }
}

export interface ApiRequestOptions<TBody = any, TQuery = any, TParams = any> {
  body?: TBody;
  query?: TQuery;
  params?: TParams;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/* ============================================================================
 * Endpoint Contract Definitions
 * ========================================================================= */

`;

  // Write contract interfaces for all scanned routes
  routes.forEach((r, idx) => {
    const routeId = `Route_${idx}`;
    r.routeId = routeId;
    code += `export interface ${routeId}_Req {\n`;
    code += `  body: ${r.bodyType};\n`;
    code += `  query: ${r.queryType};\n`;
    code += `  params: ${r.paramsType};\n`;
    code += `}\n`;
    code += `export type ${routeId}_Res = ${r.responseType};\n\n`;
  });

  // Client proxy factory and types
  code += `/* ============================================================================
 * Type-Safe Client Interface & Factory
 * ========================================================================= */

export interface WebspressoApiClient {
  [key: string]: any;
}

/**
 * Create a strongly-typed Webspresso API Client
 * @param options Client configuration options
 */
export function createWebspressoClient(options: WebspressoClientOptions = {}): WebspressoApiClient {
  const baseUrl = (options.baseUrl || '${defaultBaseUrl}').replace(/\\/+$/, '');
  const customFetch = options.fetch || (typeof fetch !== 'undefined' ? fetch : null);

  if (!customFetch) {
    throw new Error('[WebspressoClient] No global fetch found. Please provide a custom fetch in options.');
  }

  function createCaller(pathSegments: string[]): any {
    return new Proxy(function () {}, {
      get(_, prop: string) {
        if (['get', 'post', 'put', 'patch', 'delete'].includes(prop)) {
          return async (reqOpts: any = {}) => {
            let urlPath = '/' + pathSegments.join('/');

            if (reqOpts.params) {
              for (const [k, v] of Object.entries(reqOpts.params)) {
                urlPath = urlPath.replace(':' + k, encodeURIComponent(String(v)));
                urlPath = urlPath.replace('[' + k + ']', encodeURIComponent(String(v)));
              }
            }

            if (reqOpts.query) {
              const searchParams = new URLSearchParams();
              for (const [k, v] of Object.entries(reqOpts.query)) {
                if (v !== undefined && v !== null) {
                  searchParams.append(k, String(v));
                }
              }
              const qs = searchParams.toString();
              if (qs) {
                urlPath += (urlPath.includes('?') ? '&' : '?') + qs;
              }
            }

            const fullUrl = baseUrl ? baseUrl + urlPath : urlPath;
            const headers: Record<string, string> = {
              Accept: 'application/json',
            };

            if (typeof options.headers === 'function') {
              Object.assign(headers, await options.headers());
            } else if (options.headers) {
              Object.assign(headers, options.headers);
            }

            if (options.getToken) {
              const token = await options.getToken();
              if (token) {
                headers['Authorization'] = 'Bearer ' + token;
              }
            }

            if (reqOpts.headers) {
              Object.assign(headers, reqOpts.headers);
            }

            const fetchOpts: RequestInit = {
              method: prop.toUpperCase(),
              headers,
              signal: reqOpts.signal,
            };

            if (reqOpts.body !== undefined && prop !== 'get') {
              headers['Content-Type'] = 'application/json';
              fetchOpts.body = JSON.stringify(reqOpts.body);
            }

            const response = await customFetch(fullUrl, fetchOpts);
            const contentType = response.headers.get('content-type') || '';
            const isJson = contentType.includes('application/json');
            const data = isJson ? await response.json() : await response.text();

            if (!response.ok) {
              const errMsg = (data && typeof data === 'object' && (data.message || data.error))
                || response.statusText
                || 'Request failed';
              throw new WebspressoClientError(errMsg, response.status, data);
            }

            return data;
          };
        }

        return createCaller([...pathSegments, prop]);
      },
      apply(_, __, args) {
        if (args.length > 0) {
          return createCaller([...pathSegments, String(args[0])]);
        }
        return createCaller(pathSegments);
      },
    });
  }

  return createCaller([]);
}

export default createWebspressoClient;
`;

  return code;
}

/**
 * Generates the frontend client file
 * @param {Object} options
 * @returns {{ outFile: string, routesCount: number }}
 */
function generateClient(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const pagesDir = options.pagesDir || 'pages';
  const defaultOut = fs.existsSync(path.join(rootDir, 'src'))
    ? path.join(rootDir, 'src', 'client.ts')
    : path.join(rootDir, '.webspresso', 'client.ts');
  const outFile = path.resolve(rootDir, options.outFile || defaultOut);

  const routes = collectApiRoutes(rootDir, pagesDir);
  const content = generateClientCode(routes, options);

  const outDir = path.dirname(outFile);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(outFile, content, 'utf8');

  return {
    outFile,
    routesCount: routes.length,
  };
}

class WebspressoClientError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'WebspressoClientError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Creates a universal Proxy-based Webspresso API Client
 * @param {Object} [options]
 * @param {string} [options.baseUrl='']
 * @param {Function} [options.fetch]
 * @param {Object|Function} [options.headers]
 * @param {Function} [options.getToken]
 * @returns {any}
 */
function createWebspressoClient(options = {}) {
  const baseUrl = (options.baseUrl || '').replace(/\/+$/, '');
  const customFetch = options.fetch || (typeof fetch !== 'undefined' ? fetch : null);

  if (!customFetch) {
    throw new Error('[WebspressoClient] No global fetch found. Please provide a custom fetch in options.');
  }

  function createCaller(pathSegments) {
    return new Proxy(function () {}, {
      get(_, prop) {
        if (['get', 'post', 'put', 'patch', 'delete'].includes(prop)) {
          return async (reqOpts = {}) => {
            let urlPath = '/' + pathSegments.join('/');

            if (reqOpts.params) {
              for (const [k, v] of Object.entries(reqOpts.params)) {
                urlPath = urlPath.replace(':' + k, encodeURIComponent(String(v)));
                urlPath = urlPath.replace('[' + k + ']', encodeURIComponent(String(v)));
              }
            }

            if (reqOpts.query) {
              const searchParams = new URLSearchParams();
              for (const [k, v] of Object.entries(reqOpts.query)) {
                if (v !== undefined && v !== null) {
                  if (Array.isArray(v)) {
                    v.forEach((val) => searchParams.append(k, String(val)));
                  } else {
                    searchParams.append(k, String(v));
                  }
                }
              }
              const qs = searchParams.toString();
              if (qs) {
                urlPath += (urlPath.includes('?') ? '&' : '?') + qs;
              }
            }

            const fullUrl = baseUrl ? baseUrl + urlPath : urlPath;
            const headers = {
              Accept: 'application/json',
            };

            if (typeof options.headers === 'function') {
              Object.assign(headers, await options.headers());
            } else if (options.headers) {
              Object.assign(headers, options.headers);
            }

            if (options.getToken) {
              const token = await options.getToken();
              if (token) {
                headers['Authorization'] = 'Bearer ' + token;
              }
            }

            if (reqOpts.headers) {
              Object.assign(headers, reqOpts.headers);
            }

            const fetchOpts = {
              method: prop.toUpperCase(),
              headers,
              signal: reqOpts.signal,
            };

            if (reqOpts.body !== undefined && prop !== 'get') {
              headers['Content-Type'] = 'application/json';
              fetchOpts.body = typeof reqOpts.body === 'string' ? reqOpts.body : JSON.stringify(reqOpts.body);
            }

            const response = await customFetch(fullUrl, fetchOpts);
            const contentType = response.headers && typeof response.headers.get === 'function'
              ? (response.headers.get('content-type') || '')
              : '';
            const isJson = contentType.includes('application/json');
            const data = isJson ? await response.json() : await response.text();

            if (!response.ok) {
              const errMsg = (data && typeof data === 'object' && (data.message || data.error))
                || response.statusText
                || 'Request failed';
              throw new WebspressoClientError(errMsg, response.status, data);
            }

            return data;
          };
        }

        return createCaller([...pathSegments, prop]);
      },
      apply(_, __, args) {
        if (args.length > 0) {
          return createCaller([...pathSegments, String(args[0])]);
        }
        return createCaller(pathSegments);
      },
    });
  }

  return createCaller([]);
}

module.exports = {
  generateClient,
  generateClientCode,
  collectApiRoutes,
  pathToSegments,
  extractRouteTypes,
  createWebspressoClient,
  WebspressoClientError,
};

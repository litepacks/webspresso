'use strict';

/**
 * Swagger / Scalar / OpenAPI plugin — HTTP API docs from file-based routes + Zod, optional ORM schemas
 * @module plugins/swagger
 */

const path = require('path');
const { trimUrlPathSlashes } = require('../core/url-path-normalize');
const { buildOpenApiDocument } = require('../core/openapi/build-from-api-routes');

const PKG = require(path.join(__dirname, '..', 'package.json'));

const { escapeHtml } = require('../core/utils/html');
const { stripTrailingSlash } = require('../core/utils/url');

/**
 * Generates Swagger UI HTML page
 * @param {string} specUrl - Absolute path on same origin (e.g. /_swagger/openapi.json)
 * @param {Object} [options]
 * @returns {string}
 */
function buildSwaggerUiHtml(specUrl, options = {}) {
  const title = escapeHtml(options.title || 'API Documentation');
  const docExpansion = JSON.stringify(options.docExpansion || 'list');
  const filter = JSON.stringify(options.filter !== false);
  const urlJson = JSON.stringify(specUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" crossorigin />
  <style>
    body { margin: 0; padding: 0; background: #fafafa; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui .information-container { margin-bottom: 20px; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = function () {
      SwaggerUIBundle({
        url: ${urlJson},
        dom_id: '#swagger-ui',
        deepLinking: true,
        persistAuthorization: true,
        displayRequestDuration: true,
        docExpansion: ${docExpansion},
        filter: ${filter}
      });
    };
  </script>
</body>
</html>`;
}

/**
 * Generates modern Scalar API Reference HTML page
 * @param {string} specUrl - Absolute path on same origin (e.g. /_swagger/openapi.json)
 * @param {Object} [options]
 * @returns {string}
 */
function buildScalarUiHtml(specUrl, options = {}) {
  const title = escapeHtml(options.title || 'API Reference');
  const theme = options.theme || 'default';
  const darkMode = options.darkMode !== false;
  const layout = options.layout || 'modern';
  const showSidebar = options.showSidebar !== false;
  const scalarOptions = options.scalarOptions || {};

  const configuration = {
    spec: {
      url: specUrl,
    },
    theme,
    darkMode,
    layout,
    showSidebar,
    ...scalarOptions,
  };

  if (options.proxyUrl) {
    configuration.proxyUrl = options.proxyUrl;
  }

  const configJson = JSON.stringify(configuration).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      height: 100vh;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <script
    id="api-reference"
    type="application/json">
    ${configJson}
  </script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`;
}

/**
 * Generates Admin Panel client component to embed API docs
 * @param {Object} opts
 * @returns {string}
 */
function generateApiDocsAdminComponent({ uiPath, jsonPath, title }) {
  const safeTitle = JSON.stringify(title || 'API Documentation');
  const safeUi = JSON.stringify(uiPath);
  const safeJson = JSON.stringify(jsonPath);

  return `
(function() {
  var uiUrl = ${safeUi};
  var jsonUrl = ${safeJson};
  var pageTitle = ${safeTitle};

  return {
    view: function() {
      return m('div.flex.flex-col', { style: { minHeight: 'calc(100vh - 140px)' } }, [
        m('div.flex.items-center.justify-between.p-4.bg-white.border.border-gray-200.rounded-lg.mb-4.shadow-sm', [
          m('div', [
            m('h2.text-lg.font-bold.text-gray-900', pageTitle),
            m('p.text-xs.text-gray-500', 'Interactive OpenAPI documentation & endpoint playground')
          ]),
          m('div.flex.items-center.space-x-2', [
            m('a.inline-flex.items-center.px-3.py-1.5.text-xs.font-medium.rounded.border.border-gray-300.bg-white.text-gray-700.hover:bg-gray-50', {
              href: jsonUrl,
              target: '_blank',
              rel: 'noopener noreferrer'
            }, 'View OpenAPI JSON ↗'),
            m('a.inline-flex.items-center.px-3.py-1.5.text-xs.font-medium.rounded.bg-indigo-600.text-white.hover:bg-indigo-700', {
              href: uiUrl,
              target: '_blank',
              rel: 'noopener noreferrer'
            }, 'Open Full Screen ↗')
          ])
        ]),
        m('div.flex-1.bg-white.border.border-gray-200.rounded-lg.overflow-hidden.shadow-sm', {
          style: { minHeight: '750px' }
        }, [
          m('iframe', {
            src: uiUrl,
            style: { width: '100%', height: '100%', minHeight: '750px', border: 'none' }
          })
        ])
      ]);
    }
  };
})();
`;
}

/**
 * Swagger / Scalar / OpenAPI Plugin
 *
 * @param {Object} [options]
 * @param {string} [options.path='/_swagger'] - Base path; JSON at `{path}/openapi.json`, UI at `{path}`
 * @param {'swagger'|'scalar'} [options.ui='swagger'] - Default UI playground engine ('scalar' or 'swagger')
 * @param {boolean} [options.enabled] - Default: development only
 * @param {Function} [options.authorize] - (req) => boolean
 * @param {boolean} [options.includeOrmSchemas=false] - Merge ORM components.schemas
 * @param {string[]} [options.ormExclude] - Model names to exclude when includeOrmSchemas
 * @param {string} [options.title] - OpenAPI info.title
 * @param {string} [options.version] - OpenAPI info.version
 * @param {string} [options.description] - OpenAPI info.description
 * @param {string} [options.serverUrl] - Override servers[0].url (default: BASE_URL or http://localhost:7331)
 * @param {string} [options.theme='default'] - Theme for Scalar UI
 * @param {boolean} [options.darkMode=true] - Dark mode default for Scalar UI
 * @param {boolean} [options.admin=true] - Auto-register in Admin Panel if admin-panel plugin is present
 * @param {string} [options.adminTitle='API Docs'] - Admin menu/page title
 * @param {number} [options.adminOrder=92] - Admin menu sort order
 * @param {Object} [options.scalarOptions] - Custom options passed to Scalar configuration
 * @param {Object} [options.swaggerOptions] - Custom options passed to Swagger UI
 */
function swaggerPlugin(options = {}) {
  const {
    path: basePath = '/_swagger',
    ui = 'swagger',
    enabled,
    authorize,
    includeOrmSchemas = false,
    ormExclude = [],
    jsonPath: customJsonPath,
    title,
    version,
    description,
    serverUrl,
    theme = 'default',
    darkMode = true,
    admin = true,
    adminTitle,
    adminOrder = 92,
    scalarOptions = {},
    swaggerOptions = {},
  } = options;

  const normalizedBase = `/${trimUrlPathSlashes(basePath)}`;
  const jsonPath = customJsonPath ? `/${trimUrlPathSlashes(customJsonPath)}` : `${normalizedBase}/openapi.json`;
  const uiPath = normalizedBase;
  const swaggerSubPath = `${normalizedBase}/swagger`;
  const scalarSubPath = `${normalizedBase}/scalar`;

  const docTitle = title || PKG.name || 'API';
  const docVersion = version || PKG.version || '1.0.0';
  const docDescription =
    description || 'Generated from pages/api routes and optional Zod schema exports.';

  const isScalarPrimary = String(ui).toLowerCase() === 'scalar';

  return {
    name: 'swagger',
    version: '1.2.0',

    onRoutesReady(ctx) {
      const isDev = process.env.NODE_ENV !== 'production';
      const isEnabled = enabled !== undefined ? enabled : isDev;

      if (!isEnabled) {
        return;
      }

      const forbid = (req, res) => {
        if (authorize && !authorize(req)) {
          res.status(403).json({ error: 'Forbidden' });
          return true;
        }
        return false;
      };

      const server = serverUrl || process.env.BASE_URL || 'http://localhost:7331';

      let cachedDoc = null;

      // 1. OpenAPI 3 JSON Endpoint
      ctx.addRoute('get', jsonPath, (req, res) => {
        if (forbid(req, res)) return;
        try {
          if (cachedDoc && process.env.NODE_ENV === 'production') {
            return res.json(cachedDoc);
          }
          const resolvedPagesDir = ctx.pagesDir
            || ctx.options?.pagesDir
            || (typeof ctx.options?.pages === 'string' ? ctx.options.pages : null)
            || (ctx.options?.rootDir ? path.join(ctx.options.rootDir, 'pages') : path.join(process.cwd(), 'pages'));

          const doc = buildOpenApiDocument({
            routes: ctx.routes || [],
            pagesDir: resolvedPagesDir,
            includeOrmSchemas,
            ormExclude,
            info: {
              title: docTitle,
              version: docVersion,
              description: docDescription,
            },
            servers: [{ url: stripTrailingSlash(server) }],
          });
          if (process.env.NODE_ENV === 'production') {
            cachedDoc = doc;
          }
          res.json(doc);
        } catch (err) {
          console.warn('[swagger] OpenAPI generation failed:', err.message);
          res.status(500).json({ error: 'OpenAPI generation failed', message: err.message });
        }
      });

      // 2. Swagger UI Explicit Endpoint
      ctx.addRoute('get', swaggerSubPath, (req, res) => {
        if (forbid(req, res)) return;
        res.type('html').send(
          buildSwaggerUiHtml(jsonPath, {
            title: `${docTitle} - Swagger UI`,
            ...swaggerOptions,
          })
        );
      });

      // 3. Scalar UI Explicit Endpoint
      ctx.addRoute('get', scalarSubPath, (req, res) => {
        if (forbid(req, res)) return;
        res.type('html').send(
          buildScalarUiHtml(jsonPath, {
            title: `${docTitle} - Scalar API Reference`,
            theme,
            darkMode,
            scalarOptions,
          })
        );
      });

      // 4. Primary UI Endpoint (Swagger or Scalar based on options.ui)
      ctx.addRoute('get', uiPath, (req, res) => {
        if (forbid(req, res)) return;
        if (isScalarPrimary) {
          res.type('html').send(
            buildScalarUiHtml(jsonPath, {
              title: `${docTitle} - API Reference`,
              theme,
              darkMode,
              scalarOptions,
            })
          );
        } else {
          res.type('html').send(
            buildSwaggerUiHtml(jsonPath, {
              title: `${docTitle} - API Documentation`,
              ...swaggerOptions,
            })
          );
        }
      });

      // 5. Admin Panel Integration
      const adminApi = typeof ctx.usePlugin === 'function' ? ctx.usePlugin('admin-panel') : null;
      if (adminApi && admin !== false) {
        const pageTitle = adminTitle || title || 'API Docs';
        try {
          adminApi.registerModule({
            id: 'api-docs',
            title: pageTitle,
            pages: [{
              id: 'api-docs',
              title: pageTitle,
              path: '/api-docs',
              icon: 'tool',
              component: generateApiDocsAdminComponent({
                uiPath,
                jsonPath,
                title: pageTitle,
              }),
            }],
            menu: [{
              id: 'api-docs',
              label: pageTitle,
              path: '/api-docs',
              icon: 'tool',
              order: adminOrder,
            }],
          });
        } catch (adminErr) {
          console.warn('[swagger] Failed to register admin module:', adminErr.message);
        }
      }

      if (isDev) {
        const primaryEngine = isScalarPrimary ? 'Scalar' : 'Swagger';
        console.log(`  API Docs (${primaryEngine}): ${uiPath} (OpenAPI: ${jsonPath})`);
      }
    },
  };
}

module.exports = swaggerPlugin;
module.exports.swaggerPlugin = swaggerPlugin;
module.exports.openapiPlugin = swaggerPlugin;
module.exports.apiDocsPlugin = swaggerPlugin;
module.exports.buildSwaggerUiHtml = buildSwaggerUiHtml;
module.exports.buildScalarUiHtml = buildScalarUiHtml;

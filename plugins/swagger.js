/**
 * Swagger / OpenAPI plugin — HTTP API docs from file-based routes + Zod, optional ORM schemas
 */

const path = require('path');
const { buildOpenApiDocument } = require('../core/openapi/build-from-api-routes');

const PKG = require(path.join(__dirname, '..', 'package.json'));

/**
 * @param {string} specUrl - Absolute path on same origin (e.g. /_swagger/openapi.json)
 */
function buildSwaggerUiHtml(specUrl) {
  const urlJson = JSON.stringify(specUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>API documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" crossorigin />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = function () {
      SwaggerUIBundle({
        url: ${urlJson},
        dom_id: '#swagger-ui',
        deepLinking: true
      });
    };
  </script>
</body>
</html>`;
}

/**
 * @param {Object} [options]
 * @param {string} [options.path='/_swagger'] - Base path; JSON at `{path}/openapi.json`, UI at `{path}`
 * @param {boolean} [options.enabled] - Default: development only
 * @param {Function} [options.authorize] - (req) => boolean
 * @param {boolean} [options.includeOrmSchemas] - Merge ORM components.schemas
 * @param {string[]} [options.ormExclude] - Model names to exclude when includeOrmSchemas
 * @param {string} [options.title] - OpenAPI info.title
 * @param {string} [options.version] - OpenAPI info.version
 * @param {string} [options.description] - OpenAPI info.description
 * @param {string} [options.serverUrl] - Override servers[0].url (default: BASE_URL or http://localhost:3000)
 */
function swaggerPlugin(options = {}) {
  const {
    path: basePath = '/_swagger',
    enabled,
    authorize,
    includeOrmSchemas = false,
    ormExclude = [],
    title,
    version,
    description,
    serverUrl,
  } = options;

  const normalizedBase = `/${String(basePath).replace(/^\/+|\/+$/g, '')}`;
  const jsonPath = `${normalizedBase}/openapi.json`;
  const uiPath = normalizedBase;

  return {
    name: 'swagger',
    version: '1.0.0',

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

      const server = serverUrl || process.env.BASE_URL || 'http://localhost:3000';

      ctx.addRoute('get', jsonPath, (req, res) => {
        if (forbid(req, res)) return;
        try {
          const doc = buildOpenApiDocument({
            routes: ctx.routes || [],
            pagesDir: ctx.options.pagesDir,
            includeOrmSchemas,
            ormExclude,
            info: {
              title: title || PKG.name || 'API',
              version: version || PKG.version || '1.0.0',
              description:
                description ||
                'Generated from pages/api routes and optional Zod schema exports.',
            },
            servers: [{ url: server.replace(/\/$/, '') }],
          });
          res.json(doc);
        } catch (err) {
          console.warn('[swagger] OpenAPI generation failed:', err.message);
          res.status(500).json({ error: 'OpenAPI generation failed', message: err.message });
        }
      });

      ctx.addRoute('get', uiPath, (req, res) => {
        if (forbid(req, res)) return;
        res.type('html').send(buildSwaggerUiHtml(jsonPath));
      });

      if (isDev) {
        console.log(`  Swagger UI: ${uiPath} (OpenAPI: ${jsonPath})`);
      }
    },
  };
}

module.exports = swaggerPlugin;

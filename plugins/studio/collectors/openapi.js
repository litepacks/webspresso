const { buildOpenApiDocument } = require('../../../core/openapi/build-from-api-routes');

/**
 * @param {object} ctx
 */
function collectOpenapi(ctx) {
  const routes = ctx.routes || ctx.pluginManager?.routes || [];
  const apiRoutes = routes.filter((r) => r.type === 'api');
  const pagesDir = ctx.options?.pagesDir || 'pages';

  let doc = null;
  let error = null;
  try {
    doc = buildOpenApiDocument({
      routes: apiRoutes,
      pagesDir: pathJoinPages(pagesDir),
      title: 'API',
      version: '1.0.0',
    });
  } catch (e) {
    error = e.message;
  }

  const paths = doc?.paths ? Object.keys(doc.paths) : [];
  let withSchema = 0;
  let withoutSchema = 0;
  let authProtected = 0;

  for (const pathKey of paths) {
    const methods = doc.paths[pathKey];
    for (const m of Object.keys(methods)) {
      const op = methods[m];
      if (op.requestBody || op.parameters?.length) withSchema += 1;
      else withoutSchema += 1;
      if (op.security?.length) authProtected += 1;
    }
  }

  const total = withSchema + withoutSchema;
  const coverage = total ? Math.round((withSchema / total) * 100) : 0;

  const swaggerPath = findSwaggerPath(ctx);

  return {
    error,
    totalEndpoints: total,
    withSchema,
    withoutSchema,
    authProtected,
    coveragePercent: coverage,
    swaggerUiPath: swaggerPath,
    openApiJsonPath: swaggerPath ? `${swaggerPath}/openapi.json` : null,
  };
}

function pathJoinPages(pagesDir) {
  const path = require('path');
  return path.isAbsolute(pagesDir) ? pagesDir : path.join(process.cwd(), pagesDir);
}

/**
 * @param {object} ctx
 */
function findSwaggerPath(ctx) {
  const pm = ctx.pluginManager;
  if (!pm?.customRoutes) return '/_swagger';
  const hit = pm.customRoutes.find((r) => r.path?.includes('swagger') || r.path?.includes('openapi'));
  if (hit) {
    const base = hit.path.replace(/\/openapi\.json$/, '').replace(/\/$/, '');
    return base || '/_swagger';
  }
  return '/_swagger';
}

module.exports = { collectOpenapi };

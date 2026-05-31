/**
 * Sitemap preview metadata for Studio.
 */

/**
 * @param {object} ctx
 */
function collectSitemap(ctx) {
  const routes = ctx.routes || ctx.pluginManager?.routes || [];
  const ssrRoutes = routes.filter((r) => r.type === 'ssr' || r.type === 'page');
  const dynamic = ssrRoutes.filter((r) => r.isDynamic);
  const staticRoutes = ssrRoutes.filter((r) => !r.isDynamic);

  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

  return {
    totalUrls: ssrRoutes.length,
    dynamicUrls: dynamic.length,
    staticUrls: staticRoutes.length,
    lastmodCoverage: 'Plugin-generated at /sitemap.xml',
    priorityUsage: 'Configured in sitemapPlugin',
    brokenRouteWarnings: [],
    sitemapXmlUrl: '/sitemap.xml',
    robotsTxtUrl: '/robots.txt',
    sampleRoutes: staticRoutes.slice(0, 20).map((r) => ({
      path: r.pattern || r.routePath,
      file: r.file,
    })),
    baseUrl,
  };
}

module.exports = { collectSitemap };

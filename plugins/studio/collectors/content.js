/**
 * Content layer preview for Studio (read-only).
 */

/**
 * @param {object} ctx
 */
function collectContent(ctx) {
  const pm = ctx.pluginManager;
  const contentSvc = pm?.contentService;
  const contentConfig = ctx.options?.content;

  if (!contentSvc || !contentConfig?.enabled) {
    return {
      enabled: false,
      collections: [],
      message: 'Content layer is not enabled',
    };
  }

  const index = contentSvc.index;
  const collections = index.listCollections().map((c) => {
    const items = index.getCollectionItems(c.name, { includeDrafts: true });
    const missingMeta = items.filter((i) => !i.title || !i.description).length;
    const sitemapCount = items.filter((i) => i.sitemapEligible).length;
    return {
      name: c.name,
      count: c.count,
      draftCount: c.draftCount,
      total: c.total,
      missingMeta,
      sitemapCount,
      sample: items.slice(0, 5).map((i) => ({
        slug: i.slug,
        title: i.title,
        draft: i.draft,
        url: i.url,
        sitemap: i.sitemapEligible,
      })),
    };
  });

  return {
    enabled: true,
    dir: contentConfig.dir,
    collections,
    totalItems: [...index.items.values()].length,
  };
}

module.exports = { collectContent };

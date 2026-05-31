/**
 * Nunjucks globals and helpers for content layer.
 */

/**
 * @param {import('../../core/content/service').ReturnType<import('../../core/content/service').createContentService>} contentService
 * @param {object} nunjucksEnv
 */
function registerContentNunjucks(contentService, nunjucksEnv) {
  const contentGlobal = {
    collection(name) {
      const q = contentService.collection(name);
      return {
        all: (opts) => q.all(opts),
        findBySlug: (slug, opts) => q.findBySlug(slug, opts),
        latest: (n, opts) => q.latest(n, opts),
        whereTag: (tag, opts) => q.whereTag(tag, opts),
      };
    },
    get: (collection, slug, opts) => contentService.get(collection, slug, opts),
    latest: (collection, limit) => contentService.collection(collection).latest(limit),
    tags: (collection) => contentService.tags(collection),
    related: (item, limit) => contentService.related(item, limit),
    search: (query, opts) => contentService.search(query, opts),
    collections: () => contentService.collections(),
  };

  nunjucksEnv.addGlobal('content', contentGlobal);

  return {
    content_collection: (name) => contentGlobal.collection(name),
    content_get: (collection, slug) => contentGlobal.get(collection, slug),
    content_latest: (collection, limit) => contentGlobal.latest(collection, limit),
    content_tags: (collection) => contentGlobal.tags(collection),
    content_related: (item, limit) => contentGlobal.related(item, limit),
    content_search: (query) => contentGlobal.search(query),
  };
}

module.exports = {
  registerContentNunjucks,
};

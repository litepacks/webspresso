/**
 * Collection query API (sync, backed by ContentIndex).
 */

/**
 * @param {import('./index').ContentIndex} index
 * @param {string} collectionName
 */
function createCollectionQuery(index, collectionName) {
  return {
    all(opts = {}) {
      return index.getCollectionItems(collectionName, opts);
    },
    findBySlug(slug, opts = {}) {
      return index.findBySlug(collectionName, slug, opts);
    },
    latest(n = 10, opts = {}) {
      const items = index.getCollectionItems(collectionName, opts);
      return items.slice(0, n);
    },
    whereTag(tag, opts = {}) {
      const t = String(tag).toLowerCase();
      return index.getCollectionItems(collectionName, opts).filter((item) =>
        (item.tags || []).some((x) => String(x).toLowerCase() === t)
      );
    },
  };
}

module.exports = {
  createCollectionQuery,
};

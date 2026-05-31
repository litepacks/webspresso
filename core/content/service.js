/**
 * Content service — public API for server and templates.
 */

const { createCollectionQuery } = require('./collection');

/**
 * @param {import('./index').ContentIndex} index
 * @param {import('./config').ContentResolvedConfig} config
 */
function createContentService(index, config) {
  return {
    index,
    config,

    collection(name) {
      return createCollectionQuery(index, name);
    },

    get(collection, slug, opts = {}) {
      return index.findBySlug(collection, slug, opts);
    },

    collections() {
      return index.listCollections();
    },

    search(query, opts = {}) {
      return index.search(query, opts);
    },

    related(item, limit = 5) {
      return index.related(item, limit);
    },

    tags(collection) {
      return index.tags(collection);
    },

    rebuild() {
      index.rebuild();
    },
  };
}

module.exports = {
  createContentService,
};

'use strict';

/**
 * Home page loader: three services composed in parallel (two are memoized).
 */
module.exports = {
  async load(req, ctx) {
    const [stats, latest, categories] = await Promise.all([
      ctx.service('stats.overview', {}),
      ctx.service('post.list', { page: 1, perPage: 5 }),
      ctx.service('category.list', {}),
    ]);
    return { stats, latest: latest.data, categories };
  },

  meta() {
    return {
      title: 'Home — Webspresso Fullstack Example',
      description: 'Server-rendered blog showcasing every Webspresso feature.',
    };
  },
};


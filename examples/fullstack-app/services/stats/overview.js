'use strict';

const { defineService } = require('../../lib/webspresso');

/**
 * Dashboard aggregates. Memoized for 10s; `post.create` clears the cache.
 */
module.exports = defineService({
  cache: { ttl: 10_000, key: () => 'stats:overview' },
  async handler(_input, ctx) {
    const [posts, drafts, authors, comments] = await Promise.all([
      ctx.db.getRepository('Post').count({ status: 'published' }),
      ctx.db.getRepository('Post').count({ status: 'draft' }),
      ctx.db.getRepository('User').count(),
      ctx.db.getRepository('Comment').count(),
    ]);
    return { posts, drafts, authors, comments };
  },
});


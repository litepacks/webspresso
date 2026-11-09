'use strict';

const { defineService, NotFoundError } = require('../../lib/webspresso');

/**
 * Single published post by slug, with author, category and comments (batch eager loading, no N+1).
 */
module.exports = defineService({
  schema: ({ z }) => ({
    slug: z.string().min(1).max(220),
  }),
  async handler({ slug }, ctx) {
    const post = await ctx.db
      .getRepository('Post')
      .query()
      .where('slug', slug)
      .where('status', 'published')
      .include('author', 'category', 'comments')
      .first();

    if (!post) throw new NotFoundError(`Post "${slug}" not found`);
    return post;
  },
});


'use strict';

/**
 * Paginated post listing (`/posts?page=2&category=engineering`).
 */
module.exports = {
  async load(req, ctx) {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const posts = await ctx.service('post.list', {
      page: req.query.page || 1,
      perPage: 10,
      category,
    });
    return { posts, category };
  },

  meta(req) {
    return { title: `Posts — page ${req.query.page || 1}` };
  },
};


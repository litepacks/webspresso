'use strict';

/**
 * Post detail page. `post.get-by-slug` throws NotFoundError → 404 page.
 */
module.exports = {
  async load(req, ctx) {
    const post = await ctx.service('post.getBySlug', { slug: req.params.slug });
    return { post };
  },

  meta(req, ctx) {
    const post = ctx.data?.post;
    return post ? { title: post.title, description: post.excerpt } : {};
  },
};


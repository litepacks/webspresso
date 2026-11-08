'use strict';

/**
 * GET /api/posts/:slug — single post with author, category and comments.
 */
module.exports = {
  schema: ({ z }) => ({
    params: z.object({ slug: z.string().min(1).max(220) }),
  }),
  async handler(req, res) {
    const post = await req.service('post.getBySlug', { slug: req.input.params.slug });
    return res.json({ data: post });
  },
};


'use strict';

/**
 * GET /api/posts?page=1&perPage=10&category=engineering
 */
module.exports = {
  schema: ({ z }) => ({
    query: z.object({
      page: z.coerce.number().int().min(1).optional(),
      perPage: z.coerce.number().int().min(1).max(50).optional(),
      category: z.string().max(80).optional(),
    }),
  }),
  async handler(req, res) {
    const result = await req.service('post.list', req.input.query);
    return res.json(result);
  },
};


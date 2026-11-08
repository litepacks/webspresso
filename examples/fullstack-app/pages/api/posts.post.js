'use strict';

const { writeLimiter } = require('../../lib/limiters');

/**
 * POST /api/posts — JWT-protected, rate-limited, Zod-validated; delegates to a transactional service.
 */
module.exports = {
  middleware: ['jwt', writeLimiter],
  schema: ({ z }) => ({
    body: z.object({
      title: z.string().min(3).max(200),
      body: z.string().min(1).max(50_000),
      categoryId: z.coerce.number().int().positive(),
      publish: z.boolean().optional(),
    }),
  }),
  async handler(req, res) {
    const post = await req.service('post.create', {
      ...req.input.body,
      authorId: req.user.id,
    });
    return res.status(201).json({ data: post });
  },
};


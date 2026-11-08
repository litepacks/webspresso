'use strict';

const { defineService } = require('../../lib/webspresso');

/**
 * Paginated list of published posts with eager-loaded author & category.
 * Used by both the SSR listing page and the JSON API.
 */
module.exports = defineService({
  schema: ({ z }) => ({
    page: z.coerce.number().int().min(1).default(1),
    perPage: z.coerce.number().int().min(1).max(50).default(10),
    category: z.string().max(80).optional(),
  }),
  timeout: 5000,
  async handler({ page, perPage, category }, ctx) {
    let query = ctx.db
      .getRepository('Post')
      .query()
      .where('status', 'published')
      .orderBy('published_at', 'desc')
      .include('author', 'category');

    if (category) {
      const cat = await ctx.db.getRepository('Category').findOne({ slug: category });
      if (!cat) return { data: [], total: 0, page, perPage, totalPages: 0 };
      query = query.where('category_id', cat.id);
    }

    return query.paginate({ page, perPage });
  },
});


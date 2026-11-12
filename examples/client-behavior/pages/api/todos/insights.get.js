'use strict';

const { defineApi } = require('../../../../../index');
const { getTodoInsights } = require('../../../store');

module.exports = defineApi({
  schema: ({ z }) => ({
    query: z.object({
      category: z.string().trim().max(40).optional(),
    }).optional(),
    response: z.object({
      total: z.number(),
      completed: z.number(),
      active: z.number(),
      highPriorityActive: z.number(),
      percentCompleted: z.number(),
      topCategory: z.string(),
      recommendation: z.string(),
      categoryFilter: z.string(),
      generatedAt: z.string(),
    }),
  }),
  async handler(req, res) {
    const category = req.input && req.input.query ? req.input.query.category : undefined;
    return res.json(getTodoInsights({ category }));
  },
});

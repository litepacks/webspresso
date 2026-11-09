'use strict';

const { defineApi, apiResult } = require('../../../../../index');
const { bulkTodos } = require('../../../store');

module.exports = defineApi({
  schema: ({ z }) => ({
    body: z.object({
      action: z.enum(['complete-all', 'activate-all', 'clear-completed', 'reset-demo']),
    }),
  }),
  async handler(req) {
    const summary = bulkTodos(req.input.body.action);
    return apiResult(summary, {
      invalidate: ['todos'],
    });
  },
});

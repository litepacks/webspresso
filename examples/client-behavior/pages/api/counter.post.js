'use strict';

const { defineApi, z } = require('../../../../index');
const { incrementCounter } = require('../../store');

module.exports = defineApi({
  schema: ({ z }) => ({
    body: z.object({
      amount: z.coerce.number().int().min(1).max(100).default(1),
    }),
  }),
  response: {
    200: z.object({
      count: z.number(),
    }),
  },
  async handler(req, res, ctx) {
    const count = incrementCounter(req.input.body.amount);
    return ctx.result({ count }, { invalidate: ['counter'] });
  },
});

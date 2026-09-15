const { z } = require('zod');
const { defineApi } = require('../../src/api/define-api');

module.exports = defineApi({
  schema: {
    body: z.object({
      name: z.string().min(2),
      price: z.number().positive(),
    }),
  },
  handler: async (req, ctx) => {
    return {
      id: 'item_123',
      name: req.input.body.name,
      price: req.input.body.price,
    };
  },
});

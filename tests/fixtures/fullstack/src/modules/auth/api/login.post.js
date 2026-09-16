const { defineApi } = require('../../../../../../../src/api/define-api');
const { z } = require('zod');

module.exports = defineApi({
  schema: {
    body: z.object({
      email: z.string().email(),
      password: z.string().min(4),
    }),
  },
  handler: async (req, ctx) => {
    return ctx.service('auth.login', req.input.body);
  },
});

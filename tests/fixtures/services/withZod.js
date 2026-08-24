const z = require('zod');

module.exports = {
  schema: z.object({
    username: z.string().min(3),
    age: z.number().int().positive(),
  }),
  async handler(input, ctx) {
    return { ok: true, user: input };
  },
};

/**
 * POST /api/object-auth — object export: middleware + handler + schema
 */
module.exports = {
  middleware: ['fixtureRequireAuth'],
  schema: ({ z }) => ({
    body: z.object({
      q: z.string(),
    }),
  }),
  handler: async (req, res) => {
    const results = [];
    return res.json({ results, q: req.input.body.q, mode: 'object-export' });
  },
};

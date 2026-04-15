/**
 * POST /api/doc-demo — fixture for OpenAPI / Swagger integration tests
 */

module.exports = async function handler(req, res) {
  res.json({ ok: true, title: req.body?.title });
};

module.exports.schema = ({ z }) => ({
  body: z.object({
    title: z.string(),
    count: z.coerce.number().optional(),
  }),
  response: z.object({
    ok: z.boolean(),
    title: z.string().optional(),
  }),
});

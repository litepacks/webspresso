/**
 * GET /api/rate-limit-smoke — isolated fixture (not in shared pages/)
 */
module.exports = {
  middleware: [['rateLimit', { limit: 3, windowMs: 60_000 }]],
  handler: (req, res) => res.json({ ok: true }),
};

/**
 * GET /api/db-context — fixture: req.db from internal API middleware
 */
module.exports = async function handler(req, res) {
  res.json({
    hasRequestDb: !!req.db,
    marker: req.db && req.db.__fixtureMarker,
  });
};

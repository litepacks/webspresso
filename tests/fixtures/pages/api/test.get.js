/**
 * GET /api/test
 * Test API endpoint for fixtures
 */

module.exports = async function handler(req, res) {
  res.json({
    message: 'Test API endpoint',
    query: req.query,
    timestamp: new Date().toISOString()
  });
};



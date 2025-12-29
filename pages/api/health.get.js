/**
 * GET /api/health
 * Health check endpoint
 */

module.exports = async function handler(req, res) {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0'
  });
};


/**
 * POST /api/echo
 * Echo back the request body
 */

module.exports = async function handler(req, res) {
  const { body, query, headers } = req;
  
  res.json({
    message: 'Echo response',
    received: {
      body,
      query,
      contentType: headers['content-type'] || null,
      userAgent: headers['user-agent'] || null
    },
    timestamp: new Date().toISOString()
  });
};



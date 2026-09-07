/**
 * Webspresso MCP HTTP & SSE Transport
 * Implements MCP HTTP endpoints (Server-Sent Events + HTTP POST message endpoint)
 * @module plugins/mcp/transports/sse
 */

const crypto = require('crypto');
const { createJsonRpcError, ERROR_CODES } = require('../server');

/**
 * Mounts MCP SSE and HTTP POST routes onto Express app
 * @param {Object} options
 * @param {import('express').Express} options.app
 * @param {import('../server').McpServer} options.server
 * @param {string} [options.path='/_mcp']
 * @param {import('express').RequestHandler} [options.authMiddleware]
 * @returns {{ sessions: Map<string, Object> }}
 */
function mountSseTransport(options) {
  const { app, server, path: basePath = '/_mcp', authMiddleware } = options;

  const normalizedBase = basePath.replace(/\/+$/, '');
  const sessions = new Map();

  const middlewareChain = authMiddleware ? [authMiddleware] : [];

  // 1. GET /_mcp/sse - Server-Sent Events initiation
  app.get(`${normalizedBase}/sse`, ...middlewareChain, (req, res) => {
    // Check if compression is enabled on res, opt-out for SSE
    if (typeof res.compress === 'function') {
      res.compress(false);
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const sessionId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    const endpointUri = `${normalizedBase}/messages?sessionId=${sessionId}`;

    const sessionObj = {
      id: sessionId,
      req,
      res,
      send: (data) => {
        try {
          res.write(`event: message\ndata: ${JSON.stringify(data)}\n\n`);
          if (typeof res.flush === 'function') res.flush();
        } catch (err) {
          console.warn(`[mcp-sse] Failed to write to session ${sessionId}:`, err.message);
        }
      },
    };

    sessions.set(sessionId, sessionObj);

    // Send initial endpoint event per MCP spec
    res.write(`event: endpoint\ndata: ${endpointUri}\n\n`);
    if (typeof res.flush === 'function') {
      res.flush();
    }

    // Ping interval to keep connection alive through proxies
    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch (e) {
        clearInterval(keepAlive);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sessions.delete(sessionId);
    });
  });

  // 2. POST /_mcp/messages - MCP message ingestion for an active SSE session
  app.post(`${normalizedBase}/messages`, ...middlewareChain, async (req, res) => {
    const sessionId = req.query?.sessionId;
    if (!sessionId) {
      return res.status(400).json(createJsonRpcError(null, ERROR_CODES.INVALID_PARAMS, 'Missing sessionId query parameter'));
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(404).json(createJsonRpcError(null, ERROR_CODES.INVALID_PARAMS, `Active SSE session "${sessionId}" not found`));
    }

    const message = req.body;
    if (!message || typeof message !== 'object') {
      return res.status(400).json(createJsonRpcError(null, ERROR_CODES.PARSE_ERROR, 'Invalid JSON body'));
    }

    try {
      const callCtx = { req, res, db: req.db, service: req.service };
      const response = await server.handleMessage(message, callCtx);

      if (response) {
        session.send(response);
      }

      return res.status(202).send('Accepted');
    } catch (err) {
      return res.status(500).json(createJsonRpcError(message?.id || null, ERROR_CODES.INTERNAL_ERROR, err.message));
    }
  });

  // 3. POST /_mcp - Direct Streamable HTTP endpoint for single-turn JSON-RPC execution
  app.post(`${normalizedBase}`, ...middlewareChain, async (req, res) => {
    const message = req.body;
    if (!message || typeof message !== 'object') {
      return res.status(400).json(createJsonRpcError(null, ERROR_CODES.PARSE_ERROR, 'Invalid JSON body'));
    }

    try {
      const callCtx = { req, res, db: req.db, service: req.service };
      const response = await server.handleMessage(message, callCtx);
      if (!response) {
        return res.status(204).end();
      }
      return res.json(response);
    } catch (err) {
      return res.status(500).json(createJsonRpcError(message?.id || null, ERROR_CODES.INTERNAL_ERROR, err.message));
    }
  });

  return { sessions };
}

module.exports = {
  mountSseTransport,
};

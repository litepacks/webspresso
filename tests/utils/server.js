/**
 * Standard Server Lifecycle & Ephemeral Port Test Utilities
 * Provides isolated HTTP server spinning, ephemeral port allocation, socket tracking,
 * automatic cleanup, and request helpers.
 * @module tests/utils/server
 */

const http = require('http');

/**
 * Normalizes an application instance, request listener, or existing server into an http.Server.
 *
 * @param {any} appOrHandler
 * @returns {http.Server}
 */
function normalizeServer(appOrHandler) {
  if (appOrHandler instanceof http.Server) {
    return appOrHandler;
  }
  if (typeof appOrHandler === 'function') {
    return http.createServer(appOrHandler);
  }
  if (appOrHandler && typeof appOrHandler.handle === 'function') {
    return http.createServer(appOrHandler);
  }
  if (appOrHandler && appOrHandler.server instanceof http.Server) {
    return appOrHandler.server;
  }
  if (appOrHandler && typeof appOrHandler.listen === 'function') {
    // If it has listen but not handle (e.g. wrapper), return http.createServer wrapping it
    return http.createServer((req, res) => appOrHandler(req, res));
  }
  throw new TypeError('Expected an http.Server, Express/Webspresso app, or request listener function');
}

/**
 * Safely closes an HTTP server, ensuring all active sockets are destroyed.
 *
 * @param {http.Server} server - Server instance to close
 * @param {Set<import('net').Socket>} [openSockets] - Set of tracked open sockets
 * @returns {Promise<void>}
 */
async function closeServer(server, openSockets) {
  if (!server) return;

  if (openSockets && openSockets.size > 0) {
    for (const socket of openSockets) {
      if (!socket.destroyed) {
        socket.destroy();
      }
    }
    openSockets.clear();
  }

  if (typeof server.closeAllConnections === 'function') {
    try {
      server.closeAllConnections();
    } catch (_) {}
  }

  if (server.listening) {
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  }
}

/**
 * Performs an HTTP request and parses the JSON response.
 *
 * @param {string} targetUrl - Full URL to request
 * @param {RequestInit} [init={}] - Fetch request init options
 * @returns {Promise<{ status: number, ok: boolean, headers: Headers, data: any, text: string }>}
 */
async function fetchJson(targetUrl, init = {}) {
  const headers = {
    Accept: 'application/json',
    ...(init.headers || {}),
  };

  let body = init.body;
  if (body && typeof body === 'object' && !(body instanceof Buffer) && !(body instanceof Uint8Array)) {
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
    body = JSON.stringify(body);
  }

  const res = await fetch(targetUrl, {
    ...init,
    headers,
    body,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = text;
  }

  return {
    status: res.status,
    ok: res.ok,
    headers: res.headers,
    data,
    text,
  };
}

/**
 * Performs an HTTP request and returns the response body as text.
 *
 * @param {string} targetUrl - Full URL to request
 * @param {RequestInit} [init={}] - Fetch request init options
 * @returns {Promise<{ status: number, ok: boolean, headers: Headers, text: string }>}
 */
async function fetchText(targetUrl, init = {}) {
  const res = await fetch(targetUrl, init);
  const text = await res.text();
  return {
    status: res.status,
    ok: res.ok,
    headers: res.headers,
    text,
  };
}

/**
 * Starts an isolated test server on an ephemeral OS port with socket tracking.
 *
 * @param {any} appOrHandler - Webspresso app, Express instance, request listener, or http.Server
 * @param {Object} [options={}] - Server options
 * @param {string} [options.host='127.0.0.1'] - Host to bind
 * @param {number} [options.port=0] - Port to bind (0 for ephemeral OS port)
 * @returns {Promise<{
 *   server: http.Server,
 *   port: number,
 *   host: string,
 *   baseURL: string,
 *   url: (pathname?: string) => string,
 *   close: () => Promise<void>,
 *   fetch: (pathname?: string, init?: RequestInit) => Promise<Response>,
 *   fetchJson: (pathname?: string, init?: RequestInit) => Promise<{ status: number, ok: boolean, headers: Headers, data: any, text: string }>,
 *   fetchText: (pathname?: string, init?: RequestInit) => Promise<{ status: number, ok: boolean, headers: Headers, text: string }>
 * }>}
 */
async function startTestServer(appOrHandler, options = {}) {
  const server = normalizeServer(appOrHandler);
  const host = options.host || '127.0.0.1';
  const port = options.port ?? 0;

  const openSockets = new Set();
  server.on('connection', (socket) => {
    openSockets.add(socket);
    socket.once('close', () => openSockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : address;
  const baseURL = `http://${host}:${actualPort}`;

  const close = () => closeServer(server, openSockets);

  const url = (pathname = '/') => {
    const cleanPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
    return `${baseURL}${cleanPath}`;
  };

  const fetchClient = (pathname = '/', init = {}) => {
    return fetch(url(pathname), init);
  };

  const fetchJsonClient = (pathname = '/', init = {}) => {
    return fetchJson(url(pathname), init);
  };

  const fetchTextClient = (pathname = '/', init = {}) => {
    return fetchText(url(pathname), init);
  };

  return {
    server,
    port: actualPort,
    host,
    baseURL,
    url,
    close,
    fetch: fetchClient,
    fetchJson: fetchJsonClient,
    fetchText: fetchTextClient,
  };
}

/**
 * Runs a test block within an ephemeral test server lifecycle, guaranteeing closure.
 *
 * @template T
 * @param {any} appOrHandler - Application or handler
 * @param {(serverContext: Awaited<ReturnType<typeof startTestServer>>) => Promise<T>|T} callback - Test block
 * @param {Object} [options={}] - Server options
 * @returns {Promise<T>}
 */
async function withTestServer(appOrHandler, callback, options = {}) {
  const testServer = await startTestServer(appOrHandler, options);
  try {
    return await callback(testServer);
  } finally {
    await testServer.close();
  }
}

module.exports = {
  startTestServer,
  closeServer,
  fetchJson,
  fetchText,
  withTestServer,
};

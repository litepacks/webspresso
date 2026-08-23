/**
 * Node.js HTTP Server Adapter
 * Provides server-level connection tracking, graceful closing, and forced termination
 * @module core/shutdown/http-adapter
 */

class NodeHttpAdapter {
  /**
   * @param {import('http').Server|import('https').Server} server
   */
  constructor(server) {
    if (!server) {
      throw new Error('NodeHttpAdapter requires an HTTP server instance');
    }
    this.server = server;
    /** @type {Set<import('net').Socket>} */
    this.sockets = new Set();
    this._closed = false;

    this._onConnection = this._onConnection.bind(this);
    this._onSecureConnection = this._onSecureConnection.bind(this);

    this._attachSocketListeners();
  }

  _attachSocketListeners() {
    this.server.on('connection', this._onConnection);
    this.server.on('secureConnection', this._onSecureConnection);
  }

  _trackSocket(socket) {
    if (!socket || this.sockets.has(socket)) return;
    this.sockets.add(socket);

    const cleanup = () => {
      this.sockets.delete(socket);
    };

    socket.once('close', cleanup);
  }

  _onConnection(socket) {
    this._trackSocket(socket);
  }

  _onSecureConnection(socket) {
    this._trackSocket(socket);
  }

  /**
   * Check if the server is currently listening
   * @returns {boolean}
   */
  get isListening() {
    return Boolean(this.server && this.server.listening);
  }

  /**
   * Stop accepting new connections and gracefully close existing connections
   * @returns {Promise<void>}
   */
  close() {
    return new Promise((resolve) => {
      if (!this.server || !this.server.listening) {
        this._closed = true;
        return resolve();
      }

      this.closeIdleConnections();

      this.server.close(() => {
        this._closed = true;
        resolve();
      });
    });
  }

  /**
   * Close idle keep-alive connections if supported by Node.js
   */
  closeIdleConnections() {
    if (this.server && typeof this.server.closeIdleConnections === 'function') {
      try {
        this.server.closeIdleConnections();
      } catch {
        // Ignore errors during idle closing
      }
    }
  }

  /**
   * Immediately terminate all active connections
   */
  forceClose() {
    // 1. Try Node.js native closeAllConnections (Node 18.2+)
    if (this.server && typeof this.server.closeAllConnections === 'function') {
      try {
        this.server.closeAllConnections();
      } catch {
        // Fall back to manual socket destruction below
      }
    }

    // 2. Destroy all tracked sockets with an explicit error to notify clients
    for (const socket of this.sockets) {
      try {
        if (!socket.destroyed) {
          socket.destroy(new Error('Connection closed by server shutdown'));
        }
      } catch {
        // Ignore socket destroy errors
      }
    }
    this.sockets.clear();
  }

  /**
   * Detach all listeners from the server
   */
  destroy() {
    if (this.server) {
      this.server.removeListener('connection', this._onConnection);
      this.server.removeListener('secureConnection', this._onSecureConnection);
    }
    this.sockets.clear();
  }
}

module.exports = {
  NodeHttpAdapter,
};

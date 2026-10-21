'use strict';

/**
 * Webspresso HTTP Adapter Base Class
 * Defines the contract for HTTP runtime adapters (Express, Hono, Node HTTP)
 * @module core/http/adapter
 */

class HttpAdapter {
  constructor(app = null, options = {}) {
    this.app = app;
    this.options = options;
  }

  /**
   * Register a middleware or sub-router
   * @param  {...any} args
   */
  use(...args) {
    throw new Error('HttpAdapter.use() must be implemented by subclass');
  }

  /**
   * Register a route handler for a given HTTP method
   * @param {string} method - HTTP method (get, post, put, delete, patch, all)
   * @param {string} path - URL path pattern
   * @param  {...Function} handlers - Route handler functions
   */
  route(method, path, ...handlers) {
    throw new Error('HttpAdapter.route() must be implemented by subclass');
  }

  get(path, ...handlers) {
    return this.route('get', path, ...handlers);
  }

  post(path, ...handlers) {
    return this.route('post', path, ...handlers);
  }

  put(path, ...handlers) {
    return this.route('put', path, ...handlers);
  }

  delete(path, ...handlers) {
    return this.route('delete', path, ...handlers);
  }

  patch(path, ...handlers) {
    return this.route('patch', path, ...handlers);
  }

  all(path, ...handlers) {
    return this.route('all', path, ...handlers);
  }

  /**
   * Bind server to port
   * @param {number|string} port
   * @param {Function} [callback]
   */
  listen(port, callback) {
    throw new Error('HttpAdapter.listen() must be implemented by subclass');
  }

  /**
   * Get underlying native application or framework instance
   */
  getApp() {
    return this.app;
  }
}

module.exports = { HttpAdapter };

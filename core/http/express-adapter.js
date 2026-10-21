'use strict';

/**
 * Webspresso Express HTTP Adapter
 * Default adapter implementation bridging Webspresso onto Express
 * @module core/http/express-adapter
 */

const { HttpAdapter } = require('./adapter');

class ExpressHttpAdapter extends HttpAdapter {
  constructor(app, options = {}) {
    super(app, options);
  }

  use(...args) {
    if (!this.app || typeof this.app.use !== 'function') {
      throw new Error('ExpressHttpAdapter: underlying Express app does not support .use()');
    }
    return this.app.use(...args);
  }

  route(method, path, ...handlers) {
    const m = (method || '').toLowerCase();
    if (!this.app || typeof this.app[m] !== 'function') {
      throw new Error(`ExpressHttpAdapter: unsupported HTTP method "${method}" on Express app`);
    }
    return this.app[m](path, ...handlers);
  }

  listen(port, callback) {
    if (!this.app || typeof this.app.listen !== 'function') {
      throw new Error('ExpressHttpAdapter: underlying Express app does not support .listen()');
    }
    return this.app.listen(port, callback);
  }
}

function createExpressHttpAdapter(app, options = {}) {
  return new ExpressHttpAdapter(app, options);
}

module.exports = {
  ExpressHttpAdapter,
  createExpressHttpAdapter,
};

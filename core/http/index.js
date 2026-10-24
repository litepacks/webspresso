'use strict';

/**
 * Webspresso HTTP Layer
 * @module core/http
 */

const { HttpAdapter } = require('./adapter');
const { ExpressHttpAdapter, createExpressHttpAdapter } = require('./express-adapter');
const {
  createPipelineRunner,
  runMiddlewares,
  enrichRouteError,
  validateRequestInput,
  executeApiPipeline,
  executePagePipeline,
} = require('./pipeline');

let _honoModule = null;
function getHonoModule() {
  if (!_honoModule) {
    _honoModule = require('./hono-adapter');
  }
  return _honoModule;
}

module.exports = {
  HttpAdapter,
  ExpressHttpAdapter,
  createExpressHttpAdapter,
  createPipelineRunner,
  runMiddlewares,
  enrichRouteError,
  validateRequestInput,
  executeApiPipeline,
  executePagePipeline,
};

Object.defineProperties(module.exports, {
  HonoHttpAdapter: {
    get: () => getHonoModule().HonoHttpAdapter,
    enumerable: true,
    configurable: true,
  },
  createHonoHttpAdapter: {
    get: () => getHonoModule().createHonoHttpAdapter,
    enumerable: true,
    configurable: true,
  },
});

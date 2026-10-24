'use strict';

/**
 * Webspresso Context Management Layer
 * Process-wide application context and request-scoped AsyncLocalStorage ambient context.
 *
 * @module core/context
 */

const appContext = require('./app-context');
const requestContext = require('./request');

module.exports = {
  // App context (process-wide)
  setAppContext: appContext.setAppContext,
  getAppContext: appContext.getAppContext,
  getDb: appContext.getDb,
  hasDb: appContext.hasDb,
  getShutdownManager: appContext.getShutdownManager,
  hasShutdownManager: appContext.hasShutdownManager,
  getServiceRegistry: appContext.getServiceRegistry,
  hasServiceRegistry: appContext.hasServiceRegistry,
  getEvents: appContext.getEvents,
  hasEvents: appContext.hasEvents,
  getMailer: appContext.getMailer,
  hasMailer: appContext.hasMailer,
  getCache: appContext.getCache,
  hasCache: appContext.hasCache,
  resetAppContext: appContext.resetAppContext,
  attachDbMiddleware: appContext.attachDbMiddleware,

  // Request & ambient execution context (AsyncLocalStorage)
  requestContextStorage: requestContext.requestContextStorage,
  runWithContext: requestContext.runWithContext,
  withContext: requestContext.withContext,
  getContext: requestContext.getContext,
  useContext: requestContext.useContext,
  useDb: requestContext.useDb,
  useAuth: requestContext.useAuth,
  useUser: requestContext.useUser,
  useLogger: requestContext.useLogger,
  useReq: requestContext.useReq,
  useRes: requestContext.useRes,
  useParams: requestContext.useParams,
  useQuery: requestContext.useQuery,
  useService: requestContext.useService,
  useQueue: requestContext.useQueue,
  useCache: requestContext.useCache,
  useBreaker: requestContext.useBreaker,
  useTransaction: requestContext.useTransaction,

  // Namespace accessors
  appContext,
  requestContext,
};

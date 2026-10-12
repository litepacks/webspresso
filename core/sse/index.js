/**
 * Webspresso Server-Sent Events (SSE) Module
 * @module core/sse
 */

'use strict';

const {
  ServerSentEventsStream,
  createSseStream,
  formatSseFrame,
} = require('./stream');

module.exports = {
  ServerSentEventsStream,
  createSseStream,
  formatSseFrame,
  sse: createSseStream,
};

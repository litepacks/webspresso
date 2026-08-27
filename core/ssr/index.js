/**
 * Webspresso SSR Core Module
 * @module core/ssr
 */

'use strict';

const { createHtmlStream, renderStream } = require('./stream');

module.exports = {
  createHtmlStream,
  renderStream,
};

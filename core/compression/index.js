/**
 * Webspresso HTTP Response Compression Module
 * @module core/compression
 */

const {
  supportsBrotli,
  getDefaultSupportedEncodings,
  parseAcceptEncoding,
  selectEncoding,
} = require('./negotiate');
const { isCompressible } = require('./compressible');
const { createCompressionStream } = require('./compression-stream');
const { createCompressionMiddleware, appendVary } = require('./middleware');

module.exports = {
  supportsBrotli,
  getDefaultSupportedEncodings,
  parseAcceptEncoding,
  selectEncoding,
  isCompressible,
  createCompressionStream,
  createCompressionMiddleware,
  appendVary,
};

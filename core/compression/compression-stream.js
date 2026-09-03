/**
 * Compression Stream Factory
 * Instantiates native node:zlib transform streams (brotli, gzip, deflate).
 * @module core/compression/compression-stream
 */

const zlib = require('zlib');
const { supportsBrotli } = require('./negotiate');

/**
 * Create a zlib compression transform stream based on encoding
 * @param {'br'|'gzip'|'deflate'} encoding
 * @param {Object} [options]
 * @param {number} [options.level=6] - Default compression level (0-9 for gzip/deflate, 0-11 for brotli)
 * @param {Object} [options.brotli] - Custom options for zlib.createBrotliCompress
 * @param {Object} [options.gzip] - Custom options for zlib.createGzip
 * @param {Object} [options.deflate] - Custom options for zlib.createDeflate
 * @returns {import('stream').Transform|null}
 */
function createCompressionStream(encoding, options = {}) {
  const enc = (encoding || '').toLowerCase();
  const level = typeof options.level === 'number' ? options.level : 6;

  switch (enc) {
    case 'br': {
      if (!supportsBrotli()) {
        return null;
      }
      const brotliOpts = { ...(options.brotli || {}) };
      if (!brotliOpts.params) {
        brotliOpts.params = {};
      }
      if (brotliOpts.params[zlib.constants.BROTLI_PARAM_QUALITY] === undefined) {
        // Brotli quality 4 is standard for dynamic HTTP compression (fast & high ratio)
        brotliOpts.params[zlib.constants.BROTLI_PARAM_QUALITY] = typeof options.brotli?.quality === 'number'
          ? options.brotli.quality
          : (typeof options.brotliQuality === 'number' ? options.brotliQuality : 4);
      }
      return zlib.createBrotliCompress(brotliOpts);
    }

    case 'gzip': {
      const gzipOpts = { level, ...(options.gzip || {}) };
      return zlib.createGzip(gzipOpts);
    }

    case 'deflate': {
      const deflateOpts = { level, ...(options.deflate || {}) };
      return zlib.createDeflate(deflateOpts);
    }

    default:
      return null;
  }
}

module.exports = {
  createCompressionStream,
};

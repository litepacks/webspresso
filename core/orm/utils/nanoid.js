/**
 * URL-safe ID generation compatible with the default nanoid alphabet/algorithm.
 * @module core/orm/utils/nanoid
 */

const crypto = require('crypto');

/** Same 64-char alphabet as npm `nanoid` default (URL-safe). */
const URL_ALPHABET =
  'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';

/**
 * @param {number} [size=21] - Id length (default matches nanoid)
 * @returns {string}
 */
function generateNanoid(size = 21) {
  const n = Math.max(1, Math.floor(size));
  const bytes = new Uint8Array(n);
  crypto.randomFillSync(bytes);
  let id = '';
  for (let i = 0; i < n; i++) {
    id += URL_ALPHABET[bytes[i] & 63];
  }
  return id;
}

module.exports = {
  generateNanoid,
  URL_ALPHABET,
};

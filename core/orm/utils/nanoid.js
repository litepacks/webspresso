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

/**
 * Zod schema for IDs produced by {@link generateNanoid} (same default alphabet & length).
 * Prefer **`z.nanoid()`** in API `schema: ({ z }) => …`; use this when building Zod schemas outside compiled routes.
 * @param {typeof import('zod').z} z - Zod instance (from `schema: ({ z }) => …`)
 * @param {number} [size=21]
 */
function zodNanoid(z, size = 21) {
  const n = Math.max(1, Math.floor(size));
  const alphabet = new Set(URL_ALPHABET);
  return z.string().length(n).refine((s) => [...s].every((ch) => alphabet.has(ch)), {
    message: `Expected ${n}-character nanoid (default URL alphabet)`,
  });
}

/**
 * @param {unknown} arg - `undefined` → 21; number → length; `{ maxLength }` (zdb-compatible)
 * @returns {number}
 */
function resolveNanoidSize(arg) {
  if (arg === undefined) return 21;
  if (arg === null) return 21;
  if (typeof arg === 'number' && !Number.isNaN(arg)) {
    return Math.max(1, Math.floor(arg));
  }
  if (typeof arg === 'object' && arg !== null && 'maxLength' in arg) {
    const n = /** @type {{ maxLength?: unknown }} */ (arg).maxLength;
    if (typeof n === 'number' && !Number.isNaN(n)) {
      return Math.max(1, Math.floor(n));
    }
  }
  return 21;
}

/**
 * Wraps Zod's `z` with **`z.nanoid()`** / **`z.nanoid(12)`** / **`z.nanoid({ maxLength: 12 })`**
 * without mutating the global `z` object. Used by API `schema: ({ z }) => …`.
 * @param {typeof import('zod').z} zod
 */
function extendZ(zod) {
  return new Proxy(zod, {
    get(target, prop, receiver) {
      if (prop === 'nanoid') {
        return function nanoid(arg) {
          return zodNanoid(zod, resolveNanoidSize(arg));
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

module.exports = {
  generateNanoid,
  zodNanoid,
  extendZ,
  URL_ALPHABET,
};

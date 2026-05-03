/**
 * Linear-time URL path trimming (avoid polynomial regex on long slash runs).
 */

const DEFAULT_MAX_CHARS = 4096;

/**
 * Trim leading and optional trailing ASCII '/' from a logical URL path fragment.
 * @param {unknown} raw
 * @param {{ maxChars?: number }} [opts]
 * @returns {string}
 */
function trimUrlPathSlashes(raw, opts = {}) {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  let s = raw == null ? '' : String(raw);
  if (s.length > maxChars) {
    s = s.slice(0, maxChars);
  }
  let start = 0;
  while (start < s.length && s.charCodeAt(start) === 47 /* / */) {
    start++;
  }
  let end = s.length;
  while (end > start && s.charCodeAt(end - 1) === 47) {
    end--;
  }
  return s.slice(start, end);
}

module.exports = { trimUrlPathSlashes };

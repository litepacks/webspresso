/**
 * HTTP Compression Negotiation Utilities
 * Parses Accept-Encoding headers with quality (q-value) support, wildcards, and algorithm selection.
 * @module core/compression/negotiate
 */

const zlib = require('zlib');

/**
 * Check if Brotli compression is supported by the runtime
 * @returns {boolean}
 */
function supportsBrotli() {
  return typeof zlib.createBrotliCompress === 'function';
}

/**
 * Available server-side encodings in preference order
 * @param {boolean} [includeBrotli=true]
 * @returns {string[]}
 */
function getDefaultSupportedEncodings(includeBrotli = true) {
  const encodings = [];
  if (includeBrotli && supportsBrotli()) {
    encodings.push('br');
  }
  encodings.push('gzip', 'deflate');
  return encodings;
}

/**
 * Parse an Accept-Encoding header into structured entries with q-values
 * @param {string|undefined|null} header
 * @returns {Array<{ encoding: string, q: number, index: number }>}
 */
function parseAcceptEncoding(header) {
  if (!header || typeof header !== 'string') {
    return [];
  }

  const raw = header.trim();
  if (!raw) return [];

  const parts = raw.split(',');
  const results = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;

    const [encPart, ...params] = part.split(';');
    const encoding = encPart.trim().toLowerCase();
    if (!encoding) continue;

    let q = 1.0;
    for (const param of params) {
      const trimmed = param.trim();
      if (trimmed.startsWith('q=')) {
        const val = parseFloat(trimmed.slice(2));
        if (!isNaN(val)) {
          q = Math.max(0, Math.min(1, val));
        }
      }
    }

    results.push({ encoding, q, index: i });
  }

  return results;
}

/**
 * Select the best compression encoding given client header and server supported list
 * @param {string|undefined|null} acceptEncoding - The Accept-Encoding header value
 * @param {string[]} [supportedEncodings] - Server supported encodings in preference order
 * @returns {string|null} The selected encoding ('br', 'gzip', 'deflate', 'identity', or null)
 */
function selectEncoding(acceptEncoding, supportedEncodings) {
  const supported = Array.isArray(supportedEncodings) && supportedEncodings.length > 0
    ? supportedEncodings.map(e => e.toLowerCase()).filter(e => e !== 'br' || supportsBrotli())
    : getDefaultSupportedEncodings();

  if (!acceptEncoding) {
    return 'identity';
  }

  const clientPreferences = parseAcceptEncoding(acceptEncoding);
  if (clientPreferences.length === 0) {
    return 'identity';
  }

  // Create lookup for explicit preferences
  const prefMap = new Map();
  let wildcardQ = null;

  for (const item of clientPreferences) {
    if (item.encoding === '*') {
      wildcardQ = item.q;
    } else {
      prefMap.set(item.encoding, item.q);
    }
  }

  // If identity is explicitly forbidden (q=0) and no other encoding matches, we must handle carefully
  const identityQ = prefMap.has('identity') ? prefMap.get('identity') : (wildcardQ !== null ? wildcardQ : 1.0);

  // Score candidate encodings
  let bestEncoding = null;
  let bestQ = 0;
  let bestServerPriority = Infinity;

  for (let priority = 0; priority < supported.length; priority++) {
    const candidate = supported[priority];
    let q = 0;

    if (prefMap.has(candidate)) {
      q = prefMap.get(candidate);
    } else if (wildcardQ !== null) {
      q = wildcardQ;
    }

    // Must have positive q-value to be considered
    if (q > 0) {
      if (q > bestQ || (q === bestQ && priority < bestServerPriority)) {
        bestQ = q;
        bestEncoding = candidate;
        bestServerPriority = priority;
      }
    }
  }

  if (bestEncoding && bestQ > 0) {
    return bestEncoding;
  }

  // If no compressed encoding was chosen:
  // If identity or wildcard was explicitly specified, check their q values
  if (prefMap.has('identity')) {
    return prefMap.get('identity') > 0 ? 'identity' : null;
  }
  if (wildcardQ !== null) {
    return wildcardQ > 0 ? 'identity' : null;
  }

  return null;
}

module.exports = {
  supportsBrotli,
  getDefaultSupportedEncodings,
  parseAcceptEncoding,
  selectEncoding,
};

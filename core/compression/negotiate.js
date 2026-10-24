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

const DEFAULT_SUPPORTED_ENCODINGS = Object.freeze(getDefaultSupportedEncodings());
const DEFAULT_SUPPORTED_STRING = DEFAULT_SUPPORTED_ENCODINGS.join(',');
const DEFAULT_PREFERRED_ENCODING = DEFAULT_SUPPORTED_ENCODINGS[0] || 'identity';

const selectEncodingCache = new Map();
const MAX_ENCODING_CACHE_SIZE = 256;

function setSelectEncodingCache(key, value) {
  if (selectEncodingCache.size >= MAX_ENCODING_CACHE_SIZE) {
    const firstKey = selectEncodingCache.keys().next().value;
    selectEncodingCache.delete(firstKey);
  }
  selectEncodingCache.set(key, value);
}

// Pre-fill common browser patterns for default configuration
if (DEFAULT_SUPPORTED_ENCODINGS.includes('br')) {
  selectEncodingCache.set('gzip, deflate, br', 'br');
  selectEncodingCache.set('gzip, deflate, br, zstd', 'br');
  selectEncodingCache.set('br;q=1.0, gzip;q=0.8, *;q=0.1', 'br');
}
selectEncodingCache.set('gzip, deflate', 'gzip');
selectEncodingCache.set('gzip', 'gzip');
selectEncodingCache.set('*', DEFAULT_PREFERRED_ENCODING);
selectEncodingCache.set('identity', 'identity');

/**
 * Select the best compression encoding given client header and server supported list
 * @param {string|undefined|null} acceptEncoding - The Accept-Encoding header value
 * @param {string[]} [supportedEncodings] - Server supported encodings in preference order
 * @returns {string|null} The selected encoding ('br', 'gzip', 'deflate', 'identity', or null)
 */
function selectEncoding(acceptEncoding, supportedEncodings) {
  if (!acceptEncoding || typeof acceptEncoding !== 'string') {
    return 'identity';
  }

  const raw = acceptEncoding.trim();
  if (!raw) {
    return 'identity';
  }

  const isDefault = !supportedEncodings || !Array.isArray(supportedEncodings) || supportedEncodings.length === 0;
  const cacheKey = isDefault ? raw : `${raw}|${supportedEncodings.join(',')}`;

  const cached = selectEncodingCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const supported = isDefault
    ? DEFAULT_SUPPORTED_ENCODINGS
    : supportedEncodings.map(e => e.toLowerCase()).filter(e => e !== 'br' || supportsBrotli());

  const clientPreferences = parseAcceptEncoding(raw);
  if (clientPreferences.length === 0) {
    setSelectEncodingCache(cacheKey, 'identity');
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

  let result = null;
  if (bestEncoding && bestQ > 0) {
    result = bestEncoding;
  } else if (prefMap.has('identity')) {
    result = prefMap.get('identity') > 0 ? 'identity' : null;
  } else if (wildcardQ !== null) {
    result = wildcardQ > 0 ? 'identity' : null;
  }

  setSelectEncodingCache(cacheKey, result);

  return result;
}

module.exports = {
  supportsBrotli,
  getDefaultSupportedEncodings,
  parseAcceptEncoding,
  selectEncoding,
};

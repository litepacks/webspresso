/**
 * Content-Type Compressibility Filter
 * Determines if a given MIME type benefits from HTTP compression.
 * @module core/compression/compressible
 */

// Regex patterns for MIME types that benefit from compression
const COMPRESSIBLE_TYPE_REGEX = /^(?:text\/[a-z0-9.+_-]+|application\/(?:javascript|x-javascript|json|ld\+json|manifest\+json|graphql\+json|geo\+json|xml|atom\+xml|rss\+xml|xhtml\+xml|x-yaml|yaml|vnd\.api\+json|schema\+json|hal\+json)|image\/svg\+xml)$/i;

// Regex patterns for already-compressed or non-compressible types
const INCOMPRESSIBLE_TYPE_REGEX = /^(?:text\/event-stream|image\/(?:jpeg|png|gif|webp|avif|heic|heif)|video\/[a-z0-9.+_-]+|audio\/[a-z0-9.+_-]+|application\/(?:zip|gzip|x-gzip|x-bzip2|x-compress|x-7z-compressed|x-rar-compressed|pdf|wasm|octet-stream))$/i;

const compressibleCache = new Map();
const MAX_MIME_CACHE_SIZE = 512;

// Pre-fill standard common web & API MIME types for zero-lookup warmup
const PREFILLED_MIMES = [
  ['text/html', true],
  ['text/html; charset=utf-8', true],
  ['text/plain', true],
  ['text/plain; charset=utf-8', true],
  ['text/css', true],
  ['text/css; charset=utf-8', true],
  ['text/javascript', true],
  ['text/javascript; charset=utf-8', true],
  ['application/javascript', true],
  ['application/javascript; charset=utf-8', true],
  ['application/json', true],
  ['application/json; charset=utf-8', true],
  ['application/ld+json', true],
  ['application/manifest+json', true],
  ['application/graphql+json', true],
  ['application/geo+json', true],
  ['application/xml', true],
  ['application/atom+xml', true],
  ['application/rss+xml', true],
  ['application/xhtml+xml', true],
  ['image/svg+xml', true],
  ['text/event-stream', false],
  ['image/png', false],
  ['image/jpeg', false],
  ['image/webp', false],
  ['image/gif', false],
  ['image/avif', false],
  ['application/pdf', false],
  ['application/zip', false],
  ['application/gzip', false],
  ['application/octet-stream', false],
  ['video/mp4', false],
  ['audio/mpeg', false],
];

for (const [mime, val] of PREFILLED_MIMES) {
  compressibleCache.set(mime, val);
}

function setCompressibleCache(key, value) {
  if (compressibleCache.size >= MAX_MIME_CACHE_SIZE) {
    const firstKey = compressibleCache.keys().next().value;
    compressibleCache.delete(firstKey);
  }
  compressibleCache.set(key, value);
}

/**
 * Determine if a Content-Type is compressible
 * @param {string|undefined|null} contentType - Raw Content-Type header (e.g. 'text/html; charset=utf-8')
 * @returns {boolean}
 */
function isCompressible(contentType) {
  if (!contentType || typeof contentType !== 'string') {
    return false;
  }

  const cached = compressibleCache.get(contentType);
  if (cached !== undefined) {
    return cached;
  }

  // Extract base MIME type (strip parameters like ; charset=utf-8)
  const semiIndex = contentType.indexOf(';');
  const mime = (semiIndex !== -1 ? contentType.slice(0, semiIndex) : contentType).trim().toLowerCase();

  if (!mime) {
    setCompressibleCache(contentType, false);
    return false;
  }

  // Fast negative check
  if (INCOMPRESSIBLE_TYPE_REGEX.test(mime)) {
    setCompressibleCache(contentType, false);
    return false;
  }

  // Check compressible match
  let result = false;
  if (COMPRESSIBLE_TYPE_REGEX.test(mime)) {
    result = true;
  } else if (mime.startsWith('text/') || mime.endsWith('+json') || mime.endsWith('+xml') || mime.endsWith('+yaml')) {
    result = true;
  }

  setCompressibleCache(contentType, result);

  return result;
}

module.exports = {
  isCompressible,
};

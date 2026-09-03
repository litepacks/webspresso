/**
 * Content-Type Compressibility Filter
 * Determines if a given MIME type benefits from HTTP compression.
 * @module core/compression/compressible
 */

// Regex patterns for MIME types that benefit from compression
const COMPRESSIBLE_TYPE_REGEX = /^(?:text\/[a-z0-9.+_-]+|application\/(?:javascript|x-javascript|json|ld\+json|manifest\+json|graphql\+json|geo\+json|xml|atom\+xml|rss\+xml|xhtml\+xml|x-yaml|yaml|vnd\.api\+json|schema\+json|hal\+json)|image\/svg\+xml)$/i;

// Regex patterns for already-compressed or non-compressible types
const INCOMPRESSIBLE_TYPE_REGEX = /^(?:image\/(?:jpeg|png|gif|webp|avif|heic|heif)|video\/[a-z0-9.+_-]+|audio\/[a-z0-9.+_-]+|application\/(?:zip|gzip|x-gzip|x-bzip2|x-compress|x-7z-compressed|x-rar-compressed|pdf|wasm|octet-stream))$/i;

const compressibleCache = new Map();
const MAX_MIME_CACHE_SIZE = 256;

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
    if (compressibleCache.size < MAX_MIME_CACHE_SIZE) compressibleCache.set(contentType, false);
    return false;
  }

  // Fast negative check
  if (INCOMPRESSIBLE_TYPE_REGEX.test(mime)) {
    if (compressibleCache.size < MAX_MIME_CACHE_SIZE) compressibleCache.set(contentType, false);
    return false;
  }

  // Check compressible match
  let result = false;
  if (COMPRESSIBLE_TYPE_REGEX.test(mime)) {
    result = true;
  } else if (mime.startsWith('text/') || mime.endsWith('+json') || mime.endsWith('+xml') || mime.endsWith('+yaml')) {
    result = true;
  }

  if (compressibleCache.size < MAX_MIME_CACHE_SIZE) {
    compressibleCache.set(contentType, result);
  }

  return result;
}

module.exports = {
  isCompressible,
};

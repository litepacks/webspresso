'use strict';

/**
 * Webspresso HTTP 103 Early Hints Module
 * Zero-dependency RFC 8288 / RFC 8297 compliant Early Hints dispatcher.
 * Preloads critical assets (CSS, JS, Fonts) before SSR rendering finishes to optimize TTFB, FCP and LCP.
 *
 * @module core/early-hints
 */

const EXTENSION_AS_MAP = {
  '.css': 'style',
  '.js': 'script',
  '.mjs': 'script',
  '.cjs': 'script',
  '.woff2': 'font',
  '.woff': 'font',
  '.ttf': 'font',
  '.otf': 'font',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.avif': 'image',
  '.svg': 'image',
  '.gif': 'image',
  '.ico': 'image',
  '.json': 'fetch',
  '.mp4': 'video',
  '.webm': 'video',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.ogg': 'audio',
};

/**
 * Infers the resource `as` type based on file extension
 * @param {string} url - Resource URL or path
 * @returns {string|null}
 */
function inferAsType(url) {
  if (typeof url !== 'string' || !url) return null;
  const cleanUrl = url.split('?')[0].split('#')[0];
  const lastDot = cleanUrl.lastIndexOf('.');
  if (lastDot === -1) return null;
  const ext = cleanUrl.slice(lastDot).toLowerCase();
  return EXTENSION_AS_MAP[ext] || null;
}

/**
 * Formats a single link candidate into an RFC 8288 Link header string
 * @param {string|Object} item - URL string or link options object
 * @returns {string|null}
 */
function formatLink(item) {
  if (!item) return null;

  // Already a serialized RFC 8288 Link header
  if (typeof item === 'string') {
    const trimmed = item.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('<') && trimmed.includes('>')) {
      return trimmed;
    }
    const deducedAs = inferAsType(trimmed);
    const parts = [`<${trimmed}>`, 'rel=preload'];
    if (deducedAs) {
      parts.push(`as=${deducedAs}`);
      if (deducedAs === 'font') {
        parts.push('crossorigin');
      }
    }
    return parts.join('; ');
  }

  if (typeof item === 'object') {
    const rawUrl = item.url || item.href;
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const url = rawUrl.trim();
    if (!url) return null;

    const rel = item.rel || 'preload';
    const parts = [`<${url}>`, `rel=${rel}`];

    const asType = item.as || (rel === 'preload' ? inferAsType(url) : null);
    if (asType) {
      parts.push(`as=${asType}`);
    }

    const co = item.crossOrigin !== undefined ? item.crossOrigin : item.crossorigin;
    if (co === true || co === '' || co === 'anonymous') {
      parts.push('crossorigin');
    } else if (co === 'use-credentials') {
      parts.push('crossorigin=use-credentials');
    } else if (asType === 'font' && rel === 'preload' && co === undefined) {
      // Browsers require CORS for font preloads regardless of origin
      parts.push('crossorigin');
    }

    if (item.type) {
      parts.push(`type="${item.type}"`);
    }

    if (item.media) {
      parts.push(`media="${item.media}"`);
    }

    const fetchPriority = item.fetchPriority || item.fetchpriority;
    if (fetchPriority) {
      parts.push(`fetchpriority=${fetchPriority}`);
    }

    const noPush = item.noPush !== undefined ? item.noPush : item.nopush;
    if (noPush) {
      parts.push('nopush');
    }

    return parts.join('; ');
  }

  return null;
}

/**
 * Normalizes one or more link items into an array of RFC 8288 Link header strings
 * @param {string|Object|Array<string|Object>} links
 * @returns {string[]}
 */
function formatLinkHeader(links) {
  if (!links) return [];
  const list = Array.isArray(links) ? links : [links];
  const out = [];

  for (const item of list) {
    if (!item) continue;
    if (typeof item === 'string' && item.includes(',') && !item.startsWith('<')) {
      // Comma-separated list of simple URLs
      const splitUrls = item.split(',').map((s) => s.trim()).filter(Boolean);
      for (const u of splitUrls) {
        const formatted = formatLink(u);
        if (formatted) out.push(formatted);
      }
      continue;
    }
    const formatted = formatLink(item);
    if (formatted) {
      out.push(formatted);
    }
  }

  return out;
}

/**
 * Safely sends HTTP 103 Early Hints before the final response is generated.
 * Handles Node.js runtime variations, headersSent state, and socket closure gracefully.
 *
 * @param {import('http').ServerResponse} res - Node HTTP ServerResponse
 * @param {string|Object|Array<string|Object>} hints - Links or hints map
 * @param {Function} [callback] - Optional completion callback
 * @returns {boolean} Whether Early Hints were dispatched
 */
function sendEarlyHints(res, hints, callback) {
  const cb = typeof callback === 'function' ? callback : null;

  if (!res || typeof res.writeEarlyHints !== 'function') {
    if (cb) process.nextTick(cb);
    return false;
  }

  if (res.headersSent || res.writableEnded || res.destroyed) {
    if (cb) process.nextTick(cb);
    return false;
  }

  let payload = null;

  if (Array.isArray(hints) || typeof hints === 'string') {
    const formattedLinks = formatLinkHeader(hints);
    if (formattedLinks.length === 0) {
      if (cb) process.nextTick(cb);
      return false;
    }
    payload = { link: formattedLinks };
  } else if (typeof hints === 'object' && hints !== null) {
    if (hints.url || hints.href) {
      const formatted = formatLink(hints);
      if (!formatted) {
        if (cb) process.nextTick(cb);
        return false;
      }
      payload = { link: [formatted] };
    } else {
      payload = { ...hints };
      const rawLink = payload.link || payload.Link;
      if (rawLink) {
        const formatted = formatLinkHeader(rawLink);
        if (formatted.length > 0) {
          payload.link = formatted;
          if (payload.Link) delete payload.Link;
        }
      }
    }
  } else {
    if (cb) process.nextTick(cb);
    return false;
  }

  try {
    res.writeEarlyHints(payload, (err) => {
      if (cb) cb(err || null);
    });
    return true;
  } catch (err) {
    if (cb) cb(err);
    return false;
  }
}

/**
 * Creates an Express middleware for HTTP 103 Early Hints
 * Attaches `res.earlyHints(links, cb)` to every response and optionally sends default hints on GET/HEAD requests.
 *
 * @param {boolean|Object} [options={}] - Early hints configuration
 * @param {boolean} [options.enabled=true] - Whether early hints are enabled
 * @param {string[]|Function} [options.links] - Default preload links for all GET/HEAD requests
 * @returns {Function} Express middleware
 */
function createEarlyHintsMiddleware(options = {}) {
  const opts = typeof options === 'boolean' ? { enabled: options } : (options || {});
  const enabled = opts.enabled !== false;
  const defaultLinks = opts.links || null;

  return function earlyHintsMiddleware(req, res, next) {
    // Attach res.earlyHints helper (available regardless of whether global auto hints are active)
    if (!res.earlyHints) {
      res.earlyHints = function earlyHintsHelper(links, cb) {
        return sendEarlyHints(res, links, cb);
      };
    }

    if (enabled && defaultLinks && (req.method === 'GET' || req.method === 'HEAD')) {
      try {
        const linksToSend = typeof defaultLinks === 'function' ? defaultLinks(req) : defaultLinks;
        if (linksToSend) {
          sendEarlyHints(res, linksToSend);
        }
      } catch (err) {
        // Early hints must never break normal request flow
        if (process.env.NODE_ENV === 'development') {
          console.warn('[EarlyHints] Failed to evaluate default links:', err.message);
        }
      }
    }

    next();
  };
}

module.exports = {
  EXTENSION_AS_MAP,
  inferAsType,
  formatLink,
  formatLinkHeader,
  sendEarlyHints,
  createEarlyHintsMiddleware,
};

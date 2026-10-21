/**
 * Webspresso Edge CDN Caching & Cache-Tag Invalidation Engine
 * Zero-dependency RFC 9211 / RFC 7234 Cache-Control & Edge Tag Invalidation
 * @module core/cache/cdn
 */

'use strict';

const { parseDurationMs } = require('../utils/time');

/**
 * Format duration input (number in seconds or ms, or duration string like '1h', '5m') to seconds
 * @param {string|number} val
 * @param {number} defaultSeconds
 * @returns {number}
 */
function toSeconds(val, defaultSeconds = 0) {
  if (val === undefined || val === null) return defaultSeconds;
  if (typeof val === 'number') {
    // If greater than 100_000, likely passed as ms
    return val > 100000 ? Math.floor(val / 1000) : val;
  }
  if (typeof val === 'string') {
    const ms = parseDurationMs(val, defaultSeconds * 1000);
    return Math.floor(ms / 1000);
  }
  return defaultSeconds;
}

/**
 * Build RFC-compliant Cache-Control, Cache-Tag, and Surrogate-Key headers
 * @param {Object} options
 * @param {number|string} [options.maxAge=0] - Browser max-age (in seconds or string e.g. '1m')
 * @param {number|string} [options.sMaxAge] - CDN Edge s-maxage (in seconds or string e.g. '1h')
 * @param {number|string} [options.staleWhileRevalidate] - SWR window (in seconds or string e.g. '1d')
 * @param {number|string} [options.staleIfError] - Stale if error window
 * @param {string[]|string} [options.tags] - Cache tags for targeted invalidation
 * @param {boolean} [options.public=true] - Public cacheable
 * @param {boolean} [options.private=false] - Private uncacheable
 * @param {boolean} [options.mustRevalidate=false] - Force revalidation
 * @param {boolean} [options.immutable=false] - Immutable asset
 * @returns {Record<string, string>}
 */
function buildCdnCacheHeaders(options = {}) {
  const directives = [];

  if (options.private) {
    directives.push('private');
  } else if (options.public !== false) {
    directives.push('public');
  }

  const maxAge = toSeconds(options.maxAge, 0);
  directives.push(`max-age=${maxAge}`);

  if (options.sMaxAge !== undefined) {
    const sMaxAge = toSeconds(options.sMaxAge);
    directives.push(`s-maxage=${sMaxAge}`);
  }

  if (options.staleWhileRevalidate !== undefined) {
    const swr = toSeconds(options.staleWhileRevalidate);
    directives.push(`stale-while-revalidate=${swr}`);
  }

  if (options.staleIfError !== undefined) {
    const sie = toSeconds(options.staleIfError);
    directives.push(`stale-if-error=${sie}`);
  }

  if (options.mustRevalidate) {
    directives.push('must-revalidate');
  }

  if (options.immutable) {
    directives.push('immutable');
  }

  const headers = {
    'Cache-Control': directives.join(', '),
  };

  // Cache-Tag handling (Cloudflare uses comma-separated, Fastly Surrogate-Key uses space-separated)
  if (options.tags) {
    const rawTags = Array.isArray(options.tags) ? options.tags : String(options.tags).split(',');
    const cleanTags = rawTags.map((t) => String(t).trim()).filter(Boolean);

    if (cleanTags.length > 0) {
      headers['Cache-Tag'] = cleanTags.join(',');
      headers['Surrogate-Key'] = cleanTags.join(' ');
    }
  }

  return headers;
}

/**
 * Set Edge CDN cache headers on an HTTP response (Node or Web/Hono response)
 * @param {Object} res - Express/Node res or Web Response/Headers
 * @param {Object} options - Cache options
 */
function setCdnCache(res, options = {}) {
  const headers = buildCdnCacheHeaders(options);

  for (const [key, value] of Object.entries(headers)) {
    if (typeof res.setHeader === 'function') {
      res.setHeader(key, value);
    } else if (res.headers && typeof res.headers.set === 'function') {
      res.headers.set(key, value);
    } else if (res.header && typeof res.header === 'function') {
      res.header(key, value);
    }
  }
}

/**
 * Client to purge CDN cache tags at the edge (Cloudflare, Fastly, or Custom)
 */
class CdnPurgeClient {
  /**
   * @param {Object} options
   * @param {'cloudflare'|'fastly'|'custom'|'mock'} [options.provider='mock']
   * @param {string} [options.apiToken] - Cloudflare API token or Fastly API key
   * @param {string} [options.zoneId] - Cloudflare Zone ID
   * @param {string} [options.serviceId] - Fastly Service ID
   * @param {Function} [options.purge] - Custom purge handler
   */
  constructor(options = {}) {
    this.provider = options.provider || (options.zoneId && options.apiToken ? 'cloudflare' : 'mock');
    this.apiToken = options.apiToken || process.env.CLOUDFLARE_API_TOKEN;
    this.zoneId = options.zoneId || process.env.CLOUDFLARE_ZONE_ID;
    this.serviceId = options.serviceId || process.env.FASTLY_SERVICE_ID;
    this.customPurge = options.purge || null;
    this.purgedHistory = [];
  }

  /**
   * Purge by cache tags
   * @param {string[]|string} tags
   * @returns {Promise<{ success: boolean, count?: number, error?: string }>}
   */
  async purgeTags(tags) {
    const rawTags = Array.isArray(tags) ? tags : [tags];
    const cleanTags = rawTags.map((t) => String(t).trim()).filter(Boolean);

    if (cleanTags.length === 0) {
      return { success: true, count: 0 };
    }

    this.purgedHistory.push({ type: 'tags', tags: cleanTags, timestamp: new Date() });

    if (this.provider === 'mock') {
      return { success: true, count: cleanTags.length };
    }

    if (this.provider === 'custom' && typeof this.customPurge === 'function') {
      const res = await this.customPurge({ tags: cleanTags });
      return { success: true, ...res };
    }

    if (this.provider === 'cloudflare') {
      if (!this.zoneId || !this.apiToken) {
        throw new Error('[CdnPurgeClient] Cloudflare purge requires zoneId and apiToken.');
      }

      const url = `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/purge_cache`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tags: cleanTags }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        const errorMsg = data.errors?.[0]?.message || `HTTP ${response.status}`;
        return { success: false, error: errorMsg };
      }

      return { success: true, count: cleanTags.length };
    }

    if (this.provider === 'fastly') {
      if (!this.serviceId || !this.apiToken) {
        throw new Error('[CdnPurgeClient] Fastly purge requires serviceId and apiToken.');
      }

      for (const tag of cleanTags) {
        const url = `https://api.fastly.com/service/${this.serviceId}/purge/${tag}`;
        await fetch(url, {
          method: 'POST',
          headers: {
            'Fastly-Key': this.apiToken,
            'Accept': 'application/json',
          },
        });
      }

      return { success: true, count: cleanTags.length };
    }

    return { success: true, count: cleanTags.length };
  }

  /**
   * Purge everything (full zone clear)
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async purgeAll() {
    this.purgedHistory.push({ type: 'all', timestamp: new Date() });

    if (this.provider === 'mock') {
      return { success: true };
    }

    if (this.provider === 'cloudflare') {
      const url = `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/purge_cache`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ purge_everything: true }),
      });

      const data = await response.json();
      return { success: Boolean(data.success) };
    }

    return { success: true };
  }
}

/**
 * Factory for CdnPurgeClient
 * @param {Object} options
 * @returns {CdnPurgeClient}
 */
function createCdnPurgeClient(options = {}) {
  return new CdnPurgeClient(options);
}

/**
 * Connect ORM models to automatically invalidate Edge CDN tags when records mutate
 * @param {Object} db - Webspresso database instance
 * @param {Object} config
 * @param {Record<string, (record: any) => string[]>} config.modelTags - Map of ModelName -> tag generator
 * @param {CdnPurgeClient} config.client - CdnPurgeClient instance
 */
function bindOrmCdnPurge(db, { modelTags = {}, client }) {
  if (!db || typeof db.getModel !== 'function' || !client) return;

  for (const [modelName, tagResolver] of Object.entries(modelTags)) {
    const model = db.getModel(modelName);
    if (!model) continue;

    if (!model.hooks) model.hooks = {};

    const originalAfterUpdate = model.hooks.afterUpdate;
    model.hooks.afterUpdate = async (record, ctx) => {
      let result = record;
      if (typeof originalAfterUpdate === 'function') {
        result = await originalAfterUpdate(record, ctx);
      }
      const tags = tagResolver(result);
      if (tags && tags.length > 0) {
        client.purgeTags(tags).catch(() => {});
      }
      return result;
    };

    const originalAfterDelete = model.hooks.afterDelete;
    model.hooks.afterDelete = async (record, ctx) => {
      let result = record;
      if (typeof originalAfterDelete === 'function') {
        result = await originalAfterDelete(record, ctx);
      }
      const tags = tagResolver(result);
      if (tags && tags.length > 0) {
        client.purgeTags(tags).catch(() => {});
      }
      return result;
    };
  }
}

module.exports = {
  buildCdnCacheHeaders,
  setCdnCache,
  CdnPurgeClient,
  createCdnPurgeClient,
  bindOrmCdnPurge,
};

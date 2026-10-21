'use strict';

/**
 * Webspresso - High-Performance LRU & Tagged Cache Engine
 * Zero-dependency, memory-bounded, leak-free cache primitives with stampede protection.
 * @module core/cache
 */

const { LruCache, createLruCache, safeClone } = require('./lru');
const { TaggedLruCache, createTaggedLruCache, normalizeTags } = require('./tagged-lru');
const { approximateByteSize } = require('./byte-size');
const {
  buildCdnCacheHeaders,
  setCdnCache,
  CdnPurgeClient,
  createCdnPurgeClient,
  bindOrmCdnPurge,
} = require('./cdn');

module.exports = {
  LruCache,
  createLruCache,
  TaggedLruCache,
  createTaggedLruCache,
  approximateByteSize,
  safeClone,
  normalizeTags,
  buildCdnCacheHeaders,
  setCdnCache,
  CdnPurgeClient,
  createCdnPurgeClient,
  bindOrmCdnPurge,
};

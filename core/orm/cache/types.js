/**
 * @typedef {Object} CacheSetOptions
 * @property {string[]} [tags]
 * @property {number} [ttlMs]
 */

/**
 * @typedef {Object} CacheProvider
 * @property {(key: string) => *|undefined} get
 * @property {(key: string, value: *, opts?: CacheSetOptions) => void} set
 * @property {(tags: string[]) => void} invalidateTags
 * @property {() => void} clear
 * @property {() => { entries: number, tags: number }} getSizeStats
 */

/**
 * @typedef {'auto'|'smart'} CacheStrategy
 */

/**
 * @typedef {Object} OrmCacheConfigResolved
 * @property {boolean} enabled
 * @property {CacheStrategy} defaultStrategy
 * @property {import('./memory-provider').MemoryCacheProviderOptions} [memoryOptions]
 */

module.exports = {};

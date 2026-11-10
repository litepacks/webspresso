'use strict';

/**
 * Webspresso Client Storage & Persistence Layer (`core/client/storage.js`)
 *
 * Capabilities:
 * - Unified, SSR-safe Storage Adapter for `localStorage`, `sessionStorage`, and in-memory fallback.
 * - Graceful fallback to `MemoryStorage` when running in Node.js (SSR), sandboxed iframes,
 *   or when private browsing blocks web storage with SecurityError/DOMException.
 * - Automatic JSON serialization and deserialization with fallback to raw strings.
 * - Built-in namespace prefixing (default: `w:`) to prevent collision with other applications.
 * - Safe `clear()` that only removes keys belonging to the current namespace prefix.
 * - Quota error resilience: catches `QuotaExceededError` without throwing fatal runtime crashes.
 * - Sub-namespace scoping via `storage.scoped(prefix)`.
 */

/**
 * Map-backed standard Storage implementation for Node.js SSR and private browsing fallbacks.
 */
class MemoryStorage {
  constructor() {
    this._data = new Map();
  }

  get length() {
    return this._data.size;
  }

  getItem(key) {
    const k = String(key);
    return this._data.has(k) ? this._data.get(k) : null;
  }

  setItem(key, value) {
    this._data.set(String(key), String(value));
  }

  removeItem(key) {
    this._data.delete(String(key));
  }

  clear() {
    this._data.clear();
  }

  key(index) {
    const idx = Number(index);
    if (idx < 0 || idx >= this._data.size) return null;
    let i = 0;
    for (const k of this._data.keys()) {
      if (i === idx) return k;
      i++;
    }
    return null;
  }
}

const GLOBAL_STORAGE_KEY = '__webspresso_memory_storage__';
if (!globalThis[GLOBAL_STORAGE_KEY]) {
  globalThis[GLOBAL_STORAGE_KEY] = {
    local: new MemoryStorage(),
    session: new MemoryStorage(),
    memory: new MemoryStorage(),
  };
}
const sharedMemoryBackends = globalThis[GLOBAL_STORAGE_KEY];

/**
 * Safely probe and acquire the native browser storage backend or fallback to MemoryStorage.
 *
 * @param {'local' | 'session' | 'memory'} type
 * @returns {Storage | MemoryStorage}
 */
function getNativeStorageBackend(type) {
  if (type === 'memory' || typeof window === 'undefined') {
    return sharedMemoryBackends[type] || sharedMemoryBackends.local;
  }

  try {
    const storage = type === 'session' ? window.sessionStorage : window.localStorage;
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      return sharedMemoryBackends[type] || sharedMemoryBackends.local;
    }
    // Verify write access (Safari private browsing or sandboxed iframes may throw here)
    const probeKey = '__w_storage_probe__';
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return storage;
  } catch (_e) {
    return sharedMemoryBackends[type] || sharedMemoryBackends.local;
  }
}

/**
 * Strongly-typed, prefix-aware storage adapter.
 */
class StorageAdapter {
  /**
   * @param {'local' | 'session' | 'memory'} type
   * @param {object} [options]
   * @param {string} [options.prefix='w:']
   * @param {Storage | MemoryStorage} [options.backend]
   */
  constructor(type = 'local', options = {}) {
    this.type = type;
    this.prefix = options.prefix !== undefined ? String(options.prefix) : 'w:';
    this._backend = options.backend || null;
  }

  /**
   * Resolve active storage backend.
   * @private
   */
  _getBackend() {
    if (!this._backend) {
      this._backend = getNativeStorageBackend(this.type);
    }
    return this._backend;
  }

  /**
   * Build prefixed key.
   * @private
   */
  _fullKey(key) {
    return `${this.prefix}${key}`;
  }

  /**
   * Retrieve and deserialize a value from storage.
   *
   * @param {string} key
   * @param {any} [defaultValue=null]
   * @returns {any}
   */
  get(key, defaultValue = null) {
    if (!key) return defaultValue;
    try {
      const backend = this._getBackend();
      const raw = backend.getItem(this._fullKey(key));
      if (raw === null || raw === undefined) {
        return defaultValue;
      }
      try {
        return JSON.parse(raw);
      } catch (_parseErr) {
        // Return raw string if not valid JSON
        return raw;
      }
    } catch (_err) {
      return defaultValue;
    }
  }

  /**
   * Serialize and store a value in storage.
   *
   * @param {string} key
   * @param {any} value - If undefined, the key is removed
   * @returns {boolean} True if successfully stored, false on failure (e.g. quota exceeded)
   */
  set(key, value) {
    if (!key) return false;
    if (value === undefined) {
      return this.remove(key);
    }
    try {
      const backend = this._getBackend();
      const serialized = JSON.stringify(value);
      backend.setItem(this._fullKey(key), serialized);
      return true;
    } catch (_err) {
      // QuotaExceededError or security restrictions
      return false;
    }
  }

  /**
   * Remove a key from storage.
   *
   * @param {string} key
   * @returns {boolean}
   */
  remove(key) {
    if (!key) return false;
    try {
      const backend = this._getBackend();
      backend.removeItem(this._fullKey(key));
      return true;
    } catch (_err) {
      return false;
    }
  }

  /**
   * Check whether a key exists in storage.
   *
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    if (!key) return false;
    try {
      const backend = this._getBackend();
      return backend.getItem(this._fullKey(key)) !== null;
    } catch (_err) {
      return false;
    }
  }

  /**
   * List all unprefixed keys stored under this adapter's namespace prefix.
   *
   * @returns {string[]}
   */
  keys() {
    try {
      const backend = this._getBackend();
      const result = [];
      const prefixLen = this.prefix.length;

      if (backend instanceof MemoryStorage) {
        for (const k of backend._data.keys()) {
          if (!this.prefix || k.startsWith(this.prefix)) {
            result.push(k.slice(prefixLen));
          }
        }
        return result;
      }

      if (typeof backend.length === 'number') {
        for (let i = 0; i < backend.length; i++) {
          const k = backend.key(i);
          if (k && (!this.prefix || k.startsWith(this.prefix))) {
            result.push(k.slice(prefixLen));
          }
        }
      }
      return result;
    } catch (_err) {
      return [];
    }
  }

  /**
   * Clear only keys belonging to this adapter's prefix. Never touches outside keys.
   *
   * @returns {boolean}
   */
  clear() {
    try {
      const backend = this._getBackend();
      if (!this.prefix) {
        backend.clear();
        return true;
      }
      const matchedKeys = this.keys();
      for (const k of matchedKeys) {
        backend.removeItem(this._fullKey(k));
      }
      return true;
    } catch (_err) {
      return false;
    }
  }

  /**
   * Create a sub-scoped storage adapter inheriting the same backend.
   *
   * @param {string} subPrefix
   * @returns {StorageAdapter}
   */
  scoped(subPrefix) {
    const clean = String(subPrefix || '').trim();
    const nextPrefix = clean ? `${this.prefix}${clean}:` : this.prefix;
    return new StorageAdapter(this.type, {
      prefix: nextPrefix,
      backend: this._getBackend(),
    });
  }
}

/**
 * Create a complete client storage bundle exposing `local`, `session`, `memory`, and `scoped()`.
 *
 * @param {object} [options]
 * @param {string} [options.prefix='w:'] - Root key namespace prefix
 * @param {Storage | MemoryStorage} [options.localBackend] - Custom backend for localStorage
 * @param {Storage | MemoryStorage} [options.sessionBackend] - Custom backend for sessionStorage
 * @param {MemoryStorage} [options.memoryBackend] - Custom backend for memory storage
 * @returns {ClientStorage}
 */
function createClientStorage(options = {}) {
  const prefix = options.prefix !== undefined ? String(options.prefix) : 'w:';
  const local = new StorageAdapter('local', {
    prefix,
    backend: options.localBackend || null,
  });
  const session = new StorageAdapter('session', {
    prefix,
    backend: options.sessionBackend || null,
  });
  const memory = new StorageAdapter('memory', {
    prefix,
    backend: options.memoryBackend || null,
  });

  return Object.freeze({
    local,
    session,
    memory,
    get prefix() {
      return prefix;
    },
    scoped(subPrefix) {
      const clean = String(subPrefix || '').trim();
      const nextPrefix = clean ? `${prefix}${clean}:` : prefix;
      return createClientStorage({
        ...options,
        prefix: nextPrefix,
        localBackend: local._getBackend(),
        sessionBackend: session._getBackend(),
        memoryBackend: memory._getBackend(),
      });
    },
  });
}

const defaultStorage = createClientStorage();

module.exports = {
  MemoryStorage,
  StorageAdapter,
  getNativeStorageBackend,
  createClientStorage,
  defaultStorage,
  sharedMemoryBackends,
};


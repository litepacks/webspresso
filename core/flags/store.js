/**
 * Webspresso Feature Flags Store
 * In-memory high-throughput store with file hydration support.
 * @module core/flags/store
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

class MemoryFlagStore extends EventEmitter {
  /**
   * @param {Object|string} [initialFlags] - Initial definitions or path to JSON/JS file
   */
  constructor(initialFlags) {
    super();
    /** @type {Map<string, Object|boolean>} */
    this.flags = new Map();

    if (initialFlags) {
      this.load(initialFlags);
    }
  }

  /**
   * Get flag definition by key
   * @param {string} key
   * @returns {Object|boolean|undefined}
   */
  get(key) {
    return this.flags.get(key);
  }

  /**
   * Check if a flag exists
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this.flags.has(key);
  }

  /**
   * Set or update a flag definition
   * @param {string} key
   * @param {Object|boolean} definition
   */
  set(key, definition) {
    this.flags.set(key, definition);
    this.emit('change', key, definition);
  }

  /**
   * Delete a flag
   * @param {string} key
   * @returns {boolean}
   */
  delete(key) {
    const existed = this.flags.delete(key);
    if (existed) {
      this.emit('delete', key);
    }
    return existed;
  }

  /**
   * Clear all flags
   */
  clear() {
    this.flags.clear();
    this.emit('clear');
  }

  /**
   * Return all flags as a plain key-value object
   * @returns {Record<string, any>}
   */
  getAll() {
    const out = {};
    for (const [k, v] of this.flags.entries()) {
      out[k] = v;
    }
    return out;
  }

  /**
   * Load definitions from object, json file, or js file
   * @param {Object|string} source
   */
  load(source) {
    if (!source) return;

    if (typeof source === 'object') {
      for (const [k, v] of Object.entries(source)) {
        this.flags.set(k, v);
      }
      return;
    }

    if (typeof source === 'string') {
      const resolved = path.isAbsolute(source) ? source : path.join(process.cwd(), source);
      if (fs.existsSync(resolved)) {
        if (resolved.endsWith('.json')) {
          const raw = fs.readFileSync(resolved, 'utf8');
          const parsed = JSON.parse(raw);
          this.load(parsed);
        } else {
          // JS or CJS export
          const mod = require(resolved);
          this.load(mod.default || mod);
        }
      } else {
        try {
          const parsed = JSON.parse(source);
          this.load(parsed);
        } catch (_) {}
      }
    }
  }
}

module.exports = {
  MemoryFlagStore,
};

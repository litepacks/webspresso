/**
 * Build cache — .webspresso/cache/
 * @module core/build/cache/build-cache
 */

const fs = require('fs');
const path = require('path');
const { cacheKey } = require('../graph/hash');

class BuildCache {
  /**
   * @param {string} rootDir - .webspresso/cache
   */
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.indexPath = path.join(rootDir, 'index.json');
    this.objectsDir = path.join(rootDir, 'objects');
    /** @type {Record<string, { hash: string, outputs: string[] }>} */
    this.index = {};
  }

  load() {
    if (fs.existsSync(this.indexPath)) {
      try {
        this.index = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
      } catch {
        this.index = {};
      }
    }
  }

  save() {
    fs.mkdirSync(this.rootDir, { recursive: true });
    fs.mkdirSync(this.objectsDir, { recursive: true });
    fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
  }

  /**
   * @param {string} key
   * @returns {{ hash: string, outputs: string[] } | null}
   */
  get(key) {
    return this.index[key] || null;
  }

  /**
   * @param {string} key
   * @param {string} hash
   * @param {string[]} outputs
   */
  set(key, hash, outputs) {
    this.index[key] = { hash, outputs };
  }

  /**
   * @param {string} phase
   * @param {string} inputHash
   * @param {string} adapter
   * @param {string} frameworkVersion
   * @returns {string}
   */
  makeKey(phase, inputHash, adapter, frameworkVersion) {
    return cacheKey(phase, inputHash, adapter, frameworkVersion);
  }

  /**
   * @param {string} hash
   * @param {string} content
   * @returns {string} object path
   */
  writeObject(hash, content) {
    fs.mkdirSync(this.objectsDir, { recursive: true });
    const fp = path.join(this.objectsDir, hash);
    fs.writeFileSync(fp, content);
    return fp;
  }
}

module.exports = { BuildCache };

/**
 * Webspresso Events - File-based Listener Discovery & Definition
 * Auto-discovers event listeners from `listeners/` or `events/` directories.
 * @module core/events/discovery
 */

const fs = require('fs');
const path = require('path');

/**
 * Define a typed event listener
 * @param {string|string[]} event - Event name or array of event names
 * @param {Function} handler - Handler function (data, meta) => any
 * @param {Object} [options] - Listener options ({ sender, priority, once })
 * @returns {Object}
 */
function defineListener(event, handler, options = {}) {
  if (!event) {
    throw new TypeError('Listener event must be specified');
  }
  if (typeof handler !== 'function') {
    throw new TypeError('Listener handler must be a function');
  }
  return {
    event,
    handle: handler,
    ...options,
  };
}

/**
 * Convert file path to dot-notation event name fallback
 * e.g. 'order/created.js' -> 'order.created'
 * @param {string} relPath
 * @returns {string}
 */
function filePathToEventName(relPath) {
  const parsed = path.parse(relPath);
  const parts = [];
  if (parsed.dir) {
    parts.push(...parsed.dir.split(path.sep));
  }
  parts.push(parsed.name);
  return parts.join('.');
}

/**
 * Recursively find all .js / .cjs files in a directory
 * @param {string} dir
 * @returns {string[]}
 */
function walkDirectory(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDirectory(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.cjs'))) {
      if (!entry.name.startsWith('_') && !entry.name.endsWith('.test.js')) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

/**
 * Load and register listeners from a directory into an EventDispatcher
 * @param {string} dirPath - Absolute or relative directory path
 * @param {import('./dispatcher').EventDispatcher} dispatcher
 * @param {Object} [options]
 * @returns {Array<{ file: string, event: string, handler: Function }>}
 */
function loadListeners(dirPath, dispatcher, options = {}) {
  if (!dispatcher || typeof dispatcher.on !== 'function') {
    throw new TypeError('A valid EventDispatcher instance must be provided');
  }

  const resolvedDir = path.resolve(dirPath);
  if (!fs.existsSync(resolvedDir)) {
    return [];
  }

  const filePaths = walkDirectory(resolvedDir);
  const loaded = [];

  for (const filePath of filePaths) {
    try {
      const moduleContent = require(filePath);
      const candidates = Array.isArray(moduleContent) ? moduleContent : [moduleContent];

      for (const item of candidates) {
        if (!item) continue;

        let eventName = item.event;
        let handler = item.handle || item.handler;

        // If default export is a function directly
        if (typeof item === 'function') {
          handler = item;
          eventName = item.event || filePathToEventName(path.relative(resolvedDir, filePath));
        }

        if (handler && typeof handler === 'function') {
          if (!eventName) {
            eventName = filePathToEventName(path.relative(resolvedDir, filePath));
          }

          const eventsList = Array.isArray(eventName) ? eventName : [eventName];
          for (const evt of eventsList) {
            dispatcher.on(evt, handler, {
              sender: item.sender,
              priority: item.priority,
              once: item.once,
            });

            loaded.push({
              file: filePath,
              event: evt,
              handler,
            });
          }
        }
      }
    } catch (err) {
      if (options.logger && typeof options.logger.warn === 'function') {
        options.logger.warn(`[loadListeners] Failed to load listener from ${filePath}:`, err.message);
      }
    }
  }

  return loaded;
}

module.exports = {
  defineListener,
  loadListeners,
  filePathToEventName,
};

'use strict';

/**
 * Webspresso - Command Registry & Auto-Discovery
 * Scans commands/ directory and registers custom management commands
 * @module core/commands/registry
 */

const fs = require('fs');
const path = require('path');
const { defineCommand } = require('./define-command');
const { walkDirectory } = require('../utils/fs');

/**
 * Recursively find command files in directory
 * @param {string} dir
 * @returns {string[]}
 */
function findCommandFiles(dir) {
  return walkDirectory(dir, {
    extensions: ['.js'],
    ignorePrefixes: ['_', '.'],
    ignoreTests: true,
  });
}

/**
 * Derive command name from relative path
 * e.g. "users/prune.js" -> "users:prune", "send-invoices.js" -> "send-invoices"
 * @param {string} relPath
 * @returns {string}
 */
function deriveCommandName(relPath) {
  const withoutExt = relPath.replace(/\.js$/, '');
  const segments = withoutExt.split(/[\\/]/).filter(Boolean);
  return segments.join(':');
}

/**
 * Create a CommandRegistry instance
 * @param {Object} [options]
 * @param {string} [options.commandsDir] - Root directory for commands (default: ./commands)
 * @param {boolean} [options.autoLoad=true] - Whether to discover files immediately
 * @returns {Object} CommandRegistry
 */
function createCommandRegistry(options = {}) {
  const commandsDir = options.commandsDir
    ? path.resolve(process.cwd(), options.commandsDir)
    : path.resolve(process.cwd(), 'commands');

  /** @type {Map<string, Object>} */
  const commands = new Map();

  function register(cmdDef) {
    if (!cmdDef || typeof cmdDef !== 'object') {
      throw new TypeError('Invalid command definition object');
    }
    const def = typeof cmdDef.handle === 'function' && defIsNormalized(cmdDef)
      ? cmdDef
      : defineCommand(cmdDef);

    commands.set(def.name, def);
    return def;
  }

  function defIsNormalized(obj) {
    return typeof obj.name === 'string' && typeof obj.handle === 'function' && Array.isArray(obj.options);
  }

  function load() {
    commands.clear();
    const files = findCommandFiles(commandsDir);

    for (const file of files) {
      try {
        delete require.cache[require.resolve(file)];
        const exported = require(file);
        const rel = path.relative(commandsDir, file);
        const derivedName = deriveCommandName(rel);

        let cmdDef = null;

        if (typeof exported === 'function') {
          cmdDef = defineCommand({
            name: derivedName,
            handle: exported,
          });
        } else if (exported && typeof exported === 'object') {
          // Check if exported is an ES default or CJS module
          const target = exported.default || exported;
          const name = target.name || derivedName;
          const handle = target.handle || target.run;

          if (typeof handle === 'function') {
            cmdDef = defineCommand({
              name,
              description: target.description || '',
              options: target.options || [],
              handle,
            });
          }
        }

        if (cmdDef) {
          commands.set(cmdDef.name, cmdDef);
        }
      } catch (err) {
        console.warn(`[commands] Failed to load command from "${file}":`, err.message);
      }
    }
  }

  if (options.autoLoad !== false) {
    load();
  }

  return {
    register,
    reload: load,
    has(name) {
      return commands.has(name);
    },
    get(name) {
      return commands.get(name) || null;
    },
    list() {
      return Array.from(commands.values());
    },
    names() {
      return Array.from(commands.keys());
    },
    get commandsDir() {
      return commandsDir;
    },
  };
}

module.exports = {
  createCommandRegistry,
  findCommandFiles,
  deriveCommandName,
};

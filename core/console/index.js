'use strict';

/**
 * Webspresso - Interactive Console & REPL Subsystem
 * Rails- & Tinker-inspired interactive terminal environment with pre-loaded database,
 * models, services, background queue, events, and feature flags.
 * @module core/console
 */

const { buildConsoleContext, isValidIdentifier, clearRequireCacheForDir } = require('./context');
const { registerConsoleCommands } = require('./commands');
const { evaluateInConsole } = require('./eval');
const { startConsole } = require('./repl');

module.exports = {
  buildConsoleContext,
  registerConsoleCommands,
  evaluateInConsole,
  startConsole,
  isValidIdentifier,
  clearRequireCacheForDir,
};

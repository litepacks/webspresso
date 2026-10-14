'use strict';

/**
 * Webspresso - Command Runner & Execution Engine
 * Injects framework services, database, queue, mailer, events and manages execution lifecycle
 * @module core/commands/runner
 */

/**
 * Execute a command definition with dependency injection
 * @param {Object} commandDef - Command specification returned by defineCommand
 * @param {Object} [executionOptions]
 * @param {Array<string>} [executionOptions.args] - Positional CLI arguments
 * @param {Object} [executionOptions.flags] - Named flags / options
 * @param {Object} [executionOptions.db] - Knex / ORM database instance
 * @param {Object} [executionOptions.queue] - Background job queue dispatcher
 * @param {Object} [executionOptions.services] - Service registry or caller
 * @param {Object} [executionOptions.mailer] - Mailer service
 * @param {Object} [executionOptions.events] - Application event dispatcher
 * @param {Object} [executionOptions.logger] - Logger instance (default: console)
 * @returns {Promise<{ success: boolean, result?: any, error?: Error, durationMs: number }>}
 */
async function executeCommand(commandDef, executionOptions = {}) {
  if (!commandDef || typeof commandDef !== 'object') {
    throw new TypeError('executeCommand requires a command definition');
  }

  const handleFn = commandDef.handle || commandDef.run;
  if (typeof handleFn !== 'function') {
    throw new TypeError(`Command "${commandDef.name || 'anonymous'}" has no executable handle function`);
  }

  const {
    args = [],
    flags = {},
    db = null,
    queue = null,
    services = null,
    mailer = null,
    events = null,
    logger = console,
  } = executionOptions;

  const start = Date.now();
  const context = {
    db,
    queue,
    services,
    mailer,
    events,
    logger,
    args: Array.isArray(args) ? args : [],
    flags: flags && typeof flags === 'object' ? flags : {},
  };

  try {
    const result = await handleFn(context);
    const durationMs = Date.now() - start;
    return {
      success: true,
      result,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - start;
    return {
      success: false,
      error,
      durationMs,
    };
  }
}

module.exports = {
  executeCommand,
};

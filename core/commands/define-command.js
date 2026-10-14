'use strict';

/**
 * Webspresso - Custom Command Definition
 * Inspired by Django BaseCommand & AdonisJS Ace CLI
 * @module core/commands/define-command
 */

/**
 * Define a custom CLI management command
 * @param {Object} definition
 * @param {string} definition.name - Command identifier (e.g. 'users:sync' or 'send-invoices')
 * @param {string} [definition.description] - Human-readable command description
 * @param {Array<{flags: string, description?: string, defaultValue?: any}>} [definition.options] - CLI flags
 * @param {Function} definition.handle - Execution function receiving ({ db, queue, services, mailer, events, logger, args, flags })
 * @returns {Object} Validated command specification
 */
function defineCommand(definition) {
  if (!definition || typeof definition !== 'object') {
    throw new TypeError('defineCommand requires a configuration object');
  }
  if (!definition.name || typeof definition.name !== 'string' || !definition.name.trim()) {
    throw new TypeError('Command definition must specify a non-empty string "name"');
  }
  const handleFn = definition.handle || definition.run;
  if (typeof handleFn !== 'function') {
    throw new TypeError(`Command "${definition.name}" must provide an executable "handle" function`);
  }

  const options = Array.isArray(definition.options)
    ? definition.options.map((opt) => ({
        flags: String(opt.flags || opt.name || '').trim(),
        description: opt.description || '',
        defaultValue: opt.defaultValue !== undefined ? opt.defaultValue : opt.default,
      })).filter((opt) => opt.flags.length > 0)
    : [];

  return {
    name: definition.name.trim(),
    description: definition.description || '',
    options,
    handle: handleFn,
  };
}

module.exports = {
  defineCommand,
};

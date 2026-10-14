'use strict';

/**
 * Webspresso - Management Commands Core Module
 * @module core/commands
 */

const { defineCommand } = require('./define-command');
const { createCommandRegistry, findCommandFiles, deriveCommandName } = require('./registry');
const { executeCommand } = require('./runner');

module.exports = {
  defineCommand,
  createCommandRegistry,
  findCommandFiles,
  deriveCommandName,
  executeCommand,
};

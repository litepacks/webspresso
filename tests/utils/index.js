/**
 * Webspresso Test Utilities
 * Centralized test helpers, mocks, and fixtures for the Webspresso test suite.
 * @module tests/utils
 */

const http = require('./http');
const orm = require('./orm');

module.exports = {
  ...http,
  ...orm,
};

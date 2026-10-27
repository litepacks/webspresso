'use strict';

/**
 * Webspresso Dev CLI Colors
 * Lightweight ANSI color utilities with NO_COLOR & TTY detection
 * @module src/dev/colors
 */

const isColorSupported = Boolean(
  !process.env.NO_COLOR &&
  (process.env.FORCE_COLOR || (process.stdout ? process.stdout.isTTY !== false : true))
);

/**
 * Creates color formatter helper functions
 * @param {boolean} [enabled=true]
 */
function createColors(enabled = isColorSupported) {
  function wrap(open, close) {
    return (str) => {
      if (!enabled || str == null || str === '') return String(str ?? '');
      return `${open}${str}${close}`;
    };
  }

  return {
    isColorSupported: enabled,
    bold: wrap('\x1b[1m', '\x1b[22m'),
    dim: wrap('\x1b[2m', '\x1b[22m'),
    italic: wrap('\x1b[3m', '\x1b[23m'),
    underline: wrap('\x1b[4m', '\x1b[24m'),

    // Colors
    black: wrap('\x1b[30m', '\x1b[39m'),
    red: wrap('\x1b[31m', '\x1b[39m'),
    green: wrap('\x1b[32m', '\x1b[39m'),
    yellow: wrap('\x1b[33m', '\x1b[39m'),
    blue: wrap('\x1b[34m', '\x1b[39m'),
    magenta: wrap('\x1b[35m', '\x1b[39m'),
    cyan: wrap('\x1b[36m', '\x1b[39m'),
    white: wrap('\x1b[37m', '\x1b[39m'),
    gray: wrap('\x1b[90m', '\x1b[39m'),

    // Backgrounds
    bgRed: wrap('\x1b[41m', '\x1b[49m'),
    bgGreen: wrap('\x1b[42m', '\x1b[49m'),
    bgYellow: wrap('\x1b[43m', '\x1b[49m'),
    bgBlue: wrap('\x1b[44m', '\x1b[49m'),
  };
}

const defaultColors = createColors();

/**
 * Strip all ANSI escape sequences from a string
 * @param {string} str
 * @returns {string}
 */
function stripAnsi(str) {
  if (typeof str !== 'string') return '';
  // Match standard ANSI escape codes
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

module.exports = {
  colors: defaultColors,
  createColors,
  stripAnsi,
  isColorSupported,
};

/**
 * Build pipeline errors with WS_BUILD_* codes
 * @module core/build/errors/build-error
 */

class BuildError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BuildError';
    this.code = code;
    this.details = details;
  }
}

/**
 * @param {BuildError|Error} err
 * @returns {string}
 */
function formatBuildError(err) {
  if (err instanceof BuildError) {
    const lines = [`✗ ${err.code}`, `  ${err.message}`];
    if (err.details.file) lines.push(`  File: ${err.details.file}`);
    if (err.details.hint) lines.push(`  Fix: ${err.details.hint}`);
    if (err.details.docsUrl) lines.push(`  Docs: ${err.details.docsUrl}`);
    return lines.join('\n');
  }
  return `✗ WS_BUILD_UNKNOWN\n  ${err.message}`;
}

module.exports = { BuildError, formatBuildError };

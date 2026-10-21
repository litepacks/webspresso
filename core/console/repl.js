'use strict';

/**
 * Webspresso - Interactive REPL Console Server
 * Starts an interactive Node.js REPL session with auto-injected database, models,
 * services, background queues, and custom dot commands.
 * @module core/console/repl
 */

const repl = require('repl');
const path = require('path');
const { buildConsoleContext } = require('./context');
const { registerConsoleCommands } = require('./commands');
const pkg = require('../../package.json');

/**
 * Start an interactive Webspresso REPL console session
 * @param {Object} [options]
 * @param {string} [options.rootDir] - Application root directory
 * @param {string} [options.configPath] - Path to database config
 * @param {string} [options.env] - Environment name (default: development)
 * @param {ReadableStream} [options.input] - Input stream (default: process.stdin)
 * @param {WritableStream} [options.output] - Output stream (default: process.stdout)
 * @param {boolean} [options.useColors] - Enable terminal colors (default: true)
 * @param {boolean} [options.history] - Persist command history (default: true)
 * @param {string} [options.historyPath] - History file location
 * @param {boolean} [options.banner] - Display startup banner (default: true)
 * @param {string} [options.prompt] - Custom REPL prompt
 * @returns {Promise<{ replServer: import('repl').REPLServer, context: Object, meta: Object, teardown: Function }>}
 */
async function startConsole(options = {}) {
  const { context, meta, teardown } = await buildConsoleContext(options);
  const outputStream = options.output || process.stdout;

  // Print startup banner
  if (options.banner !== false && outputStream.isTTY !== false) {
    const modelsSummary = meta.modelsCount > 0
      ? `${meta.modelsCount} models (${meta.modelNames.join(', ')})`
      : 'no models loaded';
    const servicesSummary = meta.servicesCount > 0
      ? `${meta.servicesCount} services`
      : 'no services';

    outputStream.write('\n');
    outputStream.write(`  \x1b[1;36m☕ Webspresso Interactive Console\x1b[0m \x1b[90m(v${pkg.version})\x1b[0m\n`);
    outputStream.write(`  \x1b[90mEnvironment:\x1b[0m \x1b[33m${meta.env}\x1b[0m \x1b[90m| Node.js:\x1b[0m ${process.version}\n`);
    outputStream.write(`  \x1b[90mLoaded:\x1b[0m ${modelsSummary} \x1b[90m|\x1b[0m ${servicesSummary}\n\n`);
    outputStream.write('  Type \x1b[32m.help\x1b[0m, \x1b[32m.models\x1b[0m, \x1b[32m.services\x1b[0m, or \x1b[32m.routes\x1b[0m for quick exploration.\n');
    outputStream.write('  Press \x1b[90mCtrl+D\x1b[0m or type \x1b[90m.exit\x1b[0m to quit.\n\n');
  }

  const defaultPrompt = `\x1b[36mwebspresso\x1b[0m (\x1b[33m${meta.env}\x1b[0m)> `;
  const replServer = repl.start({
    prompt: options.prompt || defaultPrompt,
    input: options.input || process.stdin,
    output: outputStream,
    useColors: options.useColors !== false,
    useGlobal: false,
    topLevelAwait: true,
    ignoreUndefined: true,
  });

  // Inject context into REPL environment
  Object.assign(replServer.context, context);

  // Setup command history persistence
  if (options.history !== false && typeof replServer.setupHistory === 'function') {
    const historyPath = options.historyPath || path.resolve(meta.rootDir, '.webspresso_history');
    try {
      replServer.setupHistory(historyPath, () => {});
    } catch (_) {
      // Gracefully continue without persistent history if write fails
    }
  }

  // Register Webspresso specific dot commands (.models, .services, etc.)
  registerConsoleCommands(replServer, {
    context,
    meta,
    rootDir: meta.rootDir,
  });

  // Clean up on exit
  let hasTeardownRun = false;
  replServer.on('exit', async () => {
    if (!hasTeardownRun) {
      hasTeardownRun = true;
      await teardown();
    }
  });

  return {
    replServer,
    context,
    meta,
    teardown,
  };
}

module.exports = {
  startConsole,
};

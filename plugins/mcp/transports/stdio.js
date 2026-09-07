/**
 * Webspresso MCP Stdio Transport
 * Runs MCP server over standard input and standard output (JSON-RPC 2.0 lines).
 * Redirects console.log to process.stderr to prevent JSON-RPC stream corruption.
 * @module plugins/mcp/transports/stdio
 */

const readline = require('readline');
const { ERROR_CODES, createJsonRpcError } = require('../server');

let originalConsoleLog = null;
let originalConsoleInfo = null;

/**
 * Redirects standard console logs to stderr
 */
function redirectConsoleToStderr() {
  if (originalConsoleLog) return;
  originalConsoleLog = console.log;
  originalConsoleInfo = console.info;

  console.log = (...args) => {
    process.stderr.write(`${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ')}\n`);
  };
  console.info = (...args) => {
    process.stderr.write(`${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ')}\n`);
  };
}

/**
 * Restores original console log functions
 */
function restoreConsole() {
  if (originalConsoleLog) {
    console.log = originalConsoleLog;
    originalConsoleLog = null;
  }
  if (originalConsoleInfo) {
    console.info = originalConsoleInfo;
    originalConsoleInfo = null;
  }
}

/**
 * Starts Stdio transport for an MCP Server
 * @param {import('../server').McpServer} server
 * @param {Object} [options]
 * @param {ReadableStream} [options.input=process.stdin]
 * @param {WritableStream} [options.output=process.stdout]
 * @param {boolean} [options.redirectStderr=true]
 * @returns {{ close: Function, rl: readline.Interface }}
 */
function startStdioTransport(server, options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const shouldRedirect = options.redirectStderr !== false;

  if (shouldRedirect) {
    redirectConsoleToStderr();
  }

  const rl = readline.createInterface({
    input,
    output: null,
    terminal: false,
  });

  const sendResponse = (msg) => {
    if (msg) {
      output.write(`${JSON.stringify(msg)}\n`);
    }
  };

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      sendResponse(createJsonRpcError(null, ERROR_CODES.PARSE_ERROR, `Parse error: ${err.message}`));
      return;
    }

    try {
      const response = await server.handleMessage(parsed);
      sendResponse(response);
    } catch (err) {
      sendResponse(createJsonRpcError(parsed?.id || null, ERROR_CODES.INTERNAL_ERROR, err.message));
    }
  });

  const close = () => {
    rl.close();
    if (shouldRedirect) {
      restoreConsole();
    }
  };

  return { close, rl };
}

module.exports = {
  startStdioTransport,
  redirectConsoleToStderr,
  restoreConsole,
};

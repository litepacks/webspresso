'use strict';

/**
 * Webspresso - Console Expression Evaluator
 * Evaluates JavaScript expressions or statements in the Webspresso context with top-level await support
 * @module core/console/eval
 */

const vm = require('vm');
const util = require('util');
const { buildConsoleContext } = require('./context');

function wrapBlock(code) {
  const lines = code.trim().split('\n');
  const lastLine = lines[lines.length - 1].trim();
  const isStatementKeyword = /^(return|const|let|var|throw|if|while|for|function|class|try|switch|import|export)\b/.test(lastLine);
  if (!isStatementKeyword && lastLine.length > 0) {
    let expr = lastLine;
    while (expr.endsWith(';')) {
      expr = expr.slice(0, -1);
    }
    lines[lines.length - 1] = `return (${expr});`;
  }
  return lines.join('\n');
}

/**
 * Evaluate JavaScript code in the Webspresso console context and return the result
 * @param {string} code - JavaScript code or expression
 * @param {Object} [options] - Options passed to buildConsoleContext
 * @returns {Promise<{ result: any, output: string, error?: Error }>}
 */
async function evaluateInConsole(code, options = {}) {
  const { context, teardown } = await buildConsoleContext(options);

  try {
    const sandbox = { ...context, console, process };
    vm.createContext(sandbox);

    let result;
    const trimmed = code.trim();

    try {
      // 1. Try as a single expression with implicit return
      const exprWrapper = `(async () => {\n  return (${trimmed});\n})()`;
      result = await vm.runInContext(exprWrapper, sandbox);
    } catch (syntaxErr) {
      if (syntaxErr?.name === 'SyntaxError' || syntaxErr instanceof SyntaxError) {
        // 2. Fall back to multi-statement block
        const blockWrapper = `(async () => {\n${wrapBlock(trimmed)}\n})()`;
        result = await vm.runInContext(blockWrapper, sandbox);
      } else {
        throw syntaxErr;
      }
    }

    const output = util.inspect(result, {
      depth: 4,
      colors: options.useColors !== false,
      compact: false,
    });

    return { result, output };
  } catch (error) {
    return { error, output: null };
  } finally {
    await teardown();
  }
}

module.exports = {
  evaluateInConsole,
};

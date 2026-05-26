/**
 * Model import barrel for worker bundle (no fs model scan on Workers)
 * @module core/build/phases/03-compile/models
 */

const fs = require('fs');
const path = require('path');

/**
 * @param {import('../../index').BuildContextInternal} ctx
 * @param {string} outputDir
 */
function compileModelImports(ctx, outputDir) {
  const modelsDir = path.resolve(ctx.cwd, ctx.config.models || 'models');
  if (!fs.existsSync(modelsDir)) {
    return '';
  }

  const files = fs
    .readdirSync(modelsDir)
    .filter((file) => file.endsWith('.js') && !file.startsWith('_'));

  if (!files.length) {
    return '';
  }

  const lines = ['/** Model registrations — webspresso build */'];
  for (const file of files) {
    const abs = path.join(modelsDir, file);
    let rel = path.relative(outputDir, abs).split(path.sep).join('/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    lines.push(`import '${rel}';`);
  }
  return lines.join('\n');
}

module.exports = { compileModelImports };

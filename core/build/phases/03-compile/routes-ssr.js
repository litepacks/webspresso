/**
 * Compile SSR route configs
 * @module core/build/phases/03-compile/routes-ssr
 */

const path = require('path');
const fs = require('fs');

/**
 * @param {object} route
 */
function configKey(route) {
  return `r${route.registrationIndex}_config`;
}

/**
 * @param {import('../../index').BuildContextInternal} ctx
 * @param {object[]} ssrRoutes
 */
function compileSsrRoutes(ctx, ssrRoutes, outputDir) {
  const lines = ['/** Generated SSR config imports — webspresso build */'];
  const exports = [];

  for (const route of ssrRoutes) {
    if (!route.configAbsPath || !fs.existsSync(route.configAbsPath)) continue;
    const key = configKey(route);
    const rel = path.relative(outputDir, route.configAbsPath).split(path.sep).join('/');
    const imp = rel.startsWith('.') ? rel : `./${rel}`;
    const modVar = `c${route.registrationIndex}`;
    lines.push(`import * as ${modVar} from '${imp}';`);
    lines.push(`export const ${key} = ${modVar};`);
    exports.push(key);
  }

  return { ssrConfigSource: lines.join('\n'), configKeys: exports };
}

module.exports = { compileSsrRoutes, configKey };

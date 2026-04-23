/**
 * Microbenchmarks: resolveMiddlewares
 */

import { bench, describe } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveMiddlewares } = require('../src/file-router.js');

const noop = (req, res, next) => next();
const factory = (opts) => (req, res, next) => next();

const registry = {
  auth: noop,
  apiAuth: (opts) => (req, res, next) => next(),
};

const config = ['auth', ['apiAuth', { role: 'admin' }], noop];

describe('resolveMiddlewares', () => {
  bench('strings + tuple + inline fn', () => {
    resolveMiddlewares(config, registry);
  });

  bench('empty config', () => {
    resolveMiddlewares([], registry);
  });
});

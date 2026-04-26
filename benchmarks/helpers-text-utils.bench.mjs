/**
 * Microbenchmarks: helpers.utils (slugify, truncate, prettyBytes, prettyMs)
 */

import { bench, describe } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { utils } = require('../src/helpers.js');

const longTitle =
  'Webspresso SSR Framework — File-Based Routing, i18n, and a Practical ORM Layer';

describe('helpers.utils', () => {
  bench('slugify (ascii)', () => {
    utils.slugify(longTitle);
  });

  bench('truncate', () => {
    utils.truncate(longTitle, 48);
  });

  bench('prettyBytes', () => {
    utils.prettyBytes(1536 * 1024);
  });

  bench('prettyMs', () => {
    utils.prettyMs(125000);
  });
});

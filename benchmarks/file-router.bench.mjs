/**
 * Microbenchmarks for file-router path helpers (Vitest bench / Tinybench).
 */

import { bench, describe } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { filePathToRoute, extractMethodFromFilename } = require('../src/file-router.js');

describe('filePathToRoute', () => {
  bench('index.njk -> /', () => {
    filePathToRoute('index.njk', '.njk');
  });

  bench('nested index', () => {
    filePathToRoute('tools/category/index.njk', '.njk');
  });

  bench('dynamic [slug]', () => {
    filePathToRoute('tools/[slug].njk', '.njk');
  });

  bench('catch-all [...rest]', () => {
    filePathToRoute('docs/[...rest].njk', '.njk');
  });

  bench('multi dynamic segments', () => {
    filePathToRoute('users/[userId]/posts/[postId].njk', '.njk');
  });
});

describe('extractMethodFromFilename', () => {
  bench('health.get.js', () => {
    extractMethodFromFilename('health.get.js');
  });

  bench('echo.post.js', () => {
    extractMethodFromFilename('echo.post.js');
  });

  bench('no method suffix (defaults to get)', () => {
    extractMethodFromFilename('handler.js');
  });

  bench('dots in basename (api.v2.get.js)', () => {
    extractMethodFromFilename('api.v2.get.js');
  });
});

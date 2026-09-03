/**
 * Microbenchmarks: Compression Negotiation & Compressibility
 */

import { bench, describe } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  selectEncoding,
  isCompressible,
} = require('../core/compression');

const acceptHeaders = [
  'gzip, deflate, br',
  'gzip, deflate, br, zstd',
  'gzip, deflate',
  'br;q=1.0, gzip;q=0.8, *;q=0.1',
  'identity',
];

const contentTypes = [
  'text/html; charset=utf-8',
  'application/json; charset=utf-8',
  'text/css',
  'application/javascript',
  'image/png',
  'image/jpeg',
  'application/problem+json',
];

describe('Compression: selectEncoding', () => {
  bench('typical browser accept-encoding (warm cache)', () => {
    for (const h of acceptHeaders) {
      selectEncoding(h);
    }
  });
});

describe('Compression: isCompressible', () => {
  bench('typical response content-types (warm cache)', () => {
    for (const ct of contentTypes) {
      isCompressible(ct);
    }
  });
});

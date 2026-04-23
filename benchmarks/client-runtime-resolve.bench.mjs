/**
 * Microbenchmarks: resolveClientRuntime
 */

import { bench, describe } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveClientRuntime } = require('../src/client-runtime/resolve.js');

describe('resolveClientRuntime', () => {
  bench('defaults (no options)', () => {
    resolveClientRuntime({});
  });

  bench('explicit alpine + swup objects', () => {
    resolveClientRuntime({
      clientRuntime: { alpine: { persist: true }, swup: { animateHistoryBrowsing: false } },
    });
  });

  bench('env overrides (WEBSPRESSO_*)', () => {
    process.env.WEBSPRESSO_ALPINE = '1';
    process.env.WEBSPRESSO_SWUP = 'true';
    try {
      resolveClientRuntime({ clientRuntime: { alpine: false, swup: false } });
    } finally {
      delete process.env.WEBSPRESSO_ALPINE;
      delete process.env.WEBSPRESSO_SWUP;
    }
  });
});

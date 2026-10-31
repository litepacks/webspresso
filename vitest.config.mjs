// import { vitestDoctorPlugin } from 'vitest-doctor';
import os from 'os';
import { defineConfig } from 'vitest/config';
import { softscopeVitest } from 'softscope/vitest';

const isCoverage =
  process.env.COVERAGE === 'true' ||
  process.env.COVERAGE === '1' ||
  process.env.SOFTSCOPE === 'false' ||
  process.env.SOFTSCOPE === '0' ||
  Boolean(process.env.npm_config_coverage) ||
  Boolean(process.env.npm_lifecycle_event?.includes('coverage')) ||
  process.argv.some(arg => arg.includes('coverage'));

// The softscope profiler reports failing tests as passed, so it is opt-in (SOFTSCOPE=true)
// and must never run in normal test or CI runs.
const softscopeEnabled = process.env.SOFTSCOPE === 'true' || process.env.SOFTSCOPE === '1';
const plugins = [];
if (softscopeEnabled && !isCoverage) {
  plugins.push(softscopeVitest({ json: 'softscope-report.json' }));
}

export default defineConfig({
  cacheDir: process.env.TMPDIR ? `${process.env.TMPDIR}/.vite` : './node_modules/.vite',
  benchmark: {
    include: ['benchmarks/**/*.bench.mjs'],
    exclude: ['node_modules', 'dist'],
    reporters: ['default'],
  },
  plugins,
  test: {
    silent: process.env.VERBOSE !== 'true',
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 60000,
    teardownTimeout: 60000,
    setupFiles: ['./tests/setup.js'],
    globalSetup: ['./tests/global-setup.js'],
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules', 'dist'],
    pool: 'forks',
    maxForks: Math.min(4, Math.max(1, (os.cpus()?.length || 4) - 1)),
    minForks: 1,
    coverage: {
      provider: 'v8',
      clean: true,
      reporter: process.env.FULL_REPORT === 'true' || process.env.CI === 'true'
        ? ['text-summary', 'json-summary', 'html', 'lcov']
        : ['text-summary', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.js', 'core/**/*.js', 'plugins/**/*.js'],
      exclude: [
        'node_modules/**',
        '**/node_modules/**',
        'tests/**',
        '**/tests/**',
        '**/fixtures/**',
        'src/**/*.test.js',
        // Browser/admin UI bundles are not executed by the Node test suite
        'plugins/admin-panel/client/**',
        'plugins/admin-panel/field-renderers/**',
        'plugins/admin-panel/vendor/**',
        'plugins/admin-panel/components.js',
        'plugins/admin-panel/app.js',
        'plugins/dashboard/app.js',
        'plugins/dashboard/styles.js',
        'plugins/content/client/**',
        'plugins/content/admin/**',
        'src/client-runtime/**',
        'core/orm/types.js',
        'core/orm/cache/types.js',
        'plugins/email/**',
      ],
      thresholds: {
        lines: 72,
        statements: 72,
        branches: 70,
        functions: 76,
      },
    },
    watch: true,
    watchExclude: ['node_modules', 'coverage'],
    reporters: ['default'],
    globals: true,
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  benchmark: {
    include: ['benchmarks/**/*.bench.mjs'],
    exclude: ['node_modules', 'dist'],
    reporters: ['verbose'],
  },
  test: {
    environment: 'node',
    testTimeout: 20000,
    setupFiles: ['./tests/setup.js'],
    globalSetup: ['./tests/global-setup.js'],
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules', 'dist'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.js', 'utils/**/*.js', 'core/**/*.js', 'plugins/**/*.js'],
      exclude: [
        'node_modules/**',
        '**/node_modules/**',
        'src/**/*.test.js',
        '**/run-demo.js',
        // Browser/admin UI bundles are not executed by the Node test suite
        'plugins/admin-panel/client/**',
        'plugins/admin-panel/field-renderers/**',
        'plugins/admin-panel/vendor/**',
        'core/orm/types.js',
        'core/orm/cache/types.js',
        'plugins/email/**',
      ],
      thresholds: {
        lines: 73,
        statements: 73,
        branches: 75,
        functions: 77,
      },
    },
    watch: true,
    watchExclude: ['node_modules', 'coverage'],
    reporters: ['verbose'],
    globals: true,
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  benchmark: {
    include: ['benchmarks/**/*.bench.mjs'],
    exclude: ['node_modules', 'dist'],
    reporters: ['verbose'],
  },
  test: {
    environment: 'node',
    testTimeout: 10000,
    setupFiles: ['./tests/setup.js'],
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
        'core/orm/types.js',
        'core/orm/cache/types.js',
      ],
      thresholds: {
        lines: 73,
        statements: 73,
        branches: 76,
        functions: 77,
      },
    },
    watch: true,
    watchExclude: ['node_modules', 'coverage'],
    reporters: ['verbose'],
    globals: true,
  },
});

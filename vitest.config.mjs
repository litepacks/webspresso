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
    hookTimeout: 30000,
    teardownTimeout: 30000,
    setupFiles: ['./tests/setup.js'],
    reporters: ['verbose'],
    globals: true,
    watch: false,
    watchExclude: ['node_modules', 'coverage'],
    fileParallelism: true,
    maxWorkers: 4,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit-integration',
          include: ['tests/**/*.test.js'],
          exclude: ['tests/unit/cli.test.js'],
          pool: 'forks',
        },
      },
      {
        extends: true,
        test: {
          name: 'cli',
          include: ['tests/unit/cli.test.js'],
          // spawnSync-heavy suite; fork RPC times out during long runs
          pool: 'threads',
          fileParallelism: false,
          testTimeout: 120000,
          hookTimeout: 120000,
        },
      },
    ],
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
        'plugins/admin-panel/client/**',
        'plugins/admin-panel/field-renderers/**',
        'src/client-runtime/bootstrap-*.js',
        'core/orm/types.js',
        'core/orm/cache/types.js',
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        branches: 78,
        functions: 80,
      },
    },
  },
});

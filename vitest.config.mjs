// import { vitestDoctorPlugin } from 'vitest-doctor';
import os from 'os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  benchmark: {
    include: ['benchmarks/**/*.bench.mjs'],
    exclude: ['node_modules', 'dist'],
    reporters: ['default'],
  },
  test: {
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 60000,
    teardownTimeout: 60000,
    setupFiles: ['./tests/setup.js'],
    globalSetup: ['./tests/global-setup.js'],
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules', 'dist'],
    pool: 'forks',
    maxForks: Math.max(1, (os.cpus()?.length || 4) - 1),
    minForks: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.js', 'core/**/*.js', 'plugins/**/*.js'],
      exclude: [
        'node_modules/**',
        '**/node_modules/**',
        'tests/**',
        '**/tests/**',
        '**/fixtures/**',
        'src/**/*.test.js',
        '**/run-demo.js',
        // Browser/admin UI bundles are not executed by the Node test suite
        'plugins/admin-panel/client/**',
        'plugins/admin-panel/field-renderers/**',
        'plugins/admin-panel/vendor/**',
        'plugins/admin-panel/components.js',
        'plugins/admin-panel/app.js',
        'plugins/admin-panel/styles.js',
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
        lines: 73,
        statements: 73,
        branches: 75,
        functions: 77,
      },
    },
    watch: true,
    watchExclude: ['node_modules', 'coverage'],
    reporters: [],
    globals: true,
  },
  plugins: [
    // vitestDoctorPlugin({
    //   output: 'doctor.html',
    //   slow: 500,           // Flag tests >= 500ms
    //   verySlow: 1500,      // Flag tests >= 1500ms
    //   relative: true,      // Detect relative statistical outliers (>5x median)
    //   medianMultiplier: 5,
    //   budgets: {
    //     maxSuiteDuration: 30000,
    //     maxTestDuration: 2000,
    //     maxRegressions: 0
    //   }
    // })
  ]
});

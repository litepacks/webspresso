import { defineConfig } from 'vitest/config';

export default defineConfig({
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
      exclude: ['src/**/*.test.js', 'node_modules'],
    },
    watch: true,
    watchExclude: ['node_modules', 'coverage'],
    reporters: ['verbose'],
    globals: true,
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',
    
    // Global test timeout
    testTimeout: 10000,
    
    // Setup files
    setupFiles: ['./tests/setup.js'],
    
    // Include patterns
    include: ['tests/**/*.test.js'],
    
    // Exclude patterns
    exclude: ['node_modules', 'dist'],
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.js'],
      exclude: ['src/**/*.test.js', 'node_modules']
    },
    
    // Watch mode settings
    watch: true,
    watchExclude: ['node_modules', 'coverage'],
    
    // Reporter settings
    reporters: ['verbose'],
    
    // Globals - makes describe, it, expect available without import
    globals: true
  }
});


/**
 * Unit Tests for utils/schemaCache.js
 */

const schemaCache = require('../../utils/schemaCache');

describe('schemaCache.js', () => {
  beforeEach(() => {
    // Clear cache before each test
    schemaCache.clear();
  });

  describe('set and get', () => {
    it('should store and retrieve schema', () => {
      const schema = { body: {}, query: {} };
      schemaCache.set('/path/to/file.js', schema);
      
      expect(schemaCache.get('/path/to/file.js')).toBe(schema);
    });

    it('should return undefined for non-existent key', () => {
      expect(schemaCache.get('/non/existent/path.js')).toBeUndefined();
    });

    it('should overwrite existing schema', () => {
      const schema1 = { body: {} };
      const schema2 = { query: {} };
      
      schemaCache.set('/path/to/file.js', schema1);
      schemaCache.set('/path/to/file.js', schema2);
      
      expect(schemaCache.get('/path/to/file.js')).toBe(schema2);
    });

    it('should store null values', () => {
      schemaCache.set('/path/to/file.js', null);
      
      expect(schemaCache.get('/path/to/file.js')).toBeNull();
    });
  });

  describe('has', () => {
    it('should return true for existing key', () => {
      schemaCache.set('/path/to/file.js', { body: {} });
      
      expect(schemaCache.has('/path/to/file.js')).toBe(true);
    });

    it('should return false for non-existent key', () => {
      expect(schemaCache.has('/non/existent/path.js')).toBe(false);
    });

    it('should return true for null values', () => {
      schemaCache.set('/path/to/file.js', null);
      
      expect(schemaCache.has('/path/to/file.js')).toBe(true);
    });
  });

  describe('del', () => {
    it('should delete existing key', () => {
      schemaCache.set('/path/to/file.js', { body: {} });
      
      const result = schemaCache.del('/path/to/file.js');
      
      expect(result).toBe(true);
      expect(schemaCache.has('/path/to/file.js')).toBe(false);
    });

    it('should return false for non-existent key', () => {
      const result = schemaCache.del('/non/existent/path.js');
      
      expect(result).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all cached schemas', () => {
      schemaCache.set('/path/to/file1.js', { body: {} });
      schemaCache.set('/path/to/file2.js', { query: {} });
      schemaCache.set('/path/to/file3.js', { params: {} });
      
      schemaCache.clear();
      
      expect(schemaCache.has('/path/to/file1.js')).toBe(false);
      expect(schemaCache.has('/path/to/file2.js')).toBe(false);
      expect(schemaCache.has('/path/to/file3.js')).toBe(false);
    });
  });

  describe('isolation', () => {
    it('should store different schemas for different paths', () => {
      const schema1 = { body: { type: 'schema1' } };
      const schema2 = { body: { type: 'schema2' } };
      
      schemaCache.set('/path/to/file1.js', schema1);
      schemaCache.set('/path/to/file2.js', schema2);
      
      expect(schemaCache.get('/path/to/file1.js')).toBe(schema1);
      expect(schemaCache.get('/path/to/file2.js')).toBe(schema2);
    });
  });
});


/**
 * Unit Tests for core/compileSchema.js
 */

const { compileSchema, invalidateSchema, clearAllSchemas } = require('../../core/compileSchema');
const schemaCache = require('../../utils/schemaCache');
const z = require('zod');

describe('compileSchema.js', () => {
  beforeEach(() => {
    // Clear cache before each test
    clearAllSchemas();
  });

  describe('compileSchema', () => {
    it('should return null when module has no schema export', () => {
      const apiModule = {
        handler: () => {}
      };
      
      const result = compileSchema('/path/to/api.js', apiModule);
      
      expect(result).toBeNull();
    });

    it('should compile schema function and return result', () => {
      const apiModule = {
        schema: ({ z }) => ({
          body: z.object({ name: z.string() }),
          query: z.object({ page: z.number() })
        })
      };
      
      const result = compileSchema('/path/to/api.js', apiModule);
      
      expect(result).toBeDefined();
      expect(result.body).toBeDefined();
      expect(result.query).toBeDefined();
    });

    it('should cache compiled schema', () => {
      const apiModule = {
        schema: ({ z }) => ({
          body: z.object({ name: z.string() })
        })
      };
      
      const result1 = compileSchema('/path/to/api.js', apiModule);
      const result2 = compileSchema('/path/to/api.js', apiModule);
      
      expect(result1).toBe(result2);
    });

    it('should return cached schema without re-compiling', () => {
      let callCount = 0;
      const apiModule = {
        schema: ({ z }) => {
          callCount++;
          return { body: z.object({ name: z.string() }) };
        }
      };
      
      compileSchema('/path/to/api.js', apiModule);
      compileSchema('/path/to/api.js', apiModule);
      compileSchema('/path/to/api.js', apiModule);
      
      expect(callCount).toBe(1);
    });

    it('should throw error when schema is not a function', () => {
      const apiModule = {
        schema: { body: {} }
      };
      
      expect(() => compileSchema('/path/to/api.js', apiModule))
        .toThrow('Schema in /path/to/api.js must be a function');
    });

    it('should throw error when schema function returns invalid type', () => {
      const apiModule = {
        schema: ({ z }) => 'invalid'
      };
      
      expect(() => compileSchema('/path/to/api.js', apiModule))
        .toThrow('Schema function in /path/to/api.js must return an object or null');
    });

    it('should accept schema returning null', () => {
      const apiModule = {
        schema: ({ z }) => null
      };
      
      const result = compileSchema('/path/to/api.js', apiModule);
      
      expect(result).toBeNull();
    });

    it('should pass z object to schema function', () => {
      let receivedZ;
      const apiModule = {
        schema: (ctx) => {
          receivedZ = ctx.z;
          return { body: ctx.z.object({}) };
        }
      };
      
      compileSchema('/path/to/api.js', apiModule);
      
      expect(receivedZ).toBeDefined();
      expect(typeof receivedZ.object).toBe('function');
      expect(typeof receivedZ.string).toBe('function');
      expect(typeof receivedZ.number).toBe('function');
    });

    it('should cache different schemas for different file paths', () => {
      const apiModule1 = {
        schema: ({ z }) => ({ body: z.object({ field1: z.string() }) })
      };
      const apiModule2 = {
        schema: ({ z }) => ({ body: z.object({ field2: z.number() }) })
      };
      
      const result1 = compileSchema('/path/to/api1.js', apiModule1);
      const result2 = compileSchema('/path/to/api2.js', apiModule2);
      
      expect(result1).not.toBe(result2);
    });

    it('should handle schema with all optional keys', () => {
      const apiModule = {
        schema: ({ z }) => ({
          body: z.object({ title: z.string() }),
          params: z.object({ id: z.string() }),
          query: z.object({ page: z.coerce.number().default(1) }),
          response: z.object({ success: z.boolean() })
        })
      };
      
      const result = compileSchema('/path/to/api.js', apiModule);
      
      expect(result.body).toBeDefined();
      expect(result.params).toBeDefined();
      expect(result.query).toBeDefined();
      expect(result.response).toBeDefined();
    });

    it('should handle partial schema (only body)', () => {
      const apiModule = {
        schema: ({ z }) => ({
          body: z.object({ name: z.string() })
        })
      };
      
      const result = compileSchema('/path/to/api.js', apiModule);
      
      expect(result.body).toBeDefined();
      expect(result.params).toBeUndefined();
      expect(result.query).toBeUndefined();
    });

    it('should cache null for modules without schema', () => {
      const apiModule = { handler: () => {} };
      
      compileSchema('/path/to/api.js', apiModule);
      
      expect(schemaCache.has('/path/to/api.js')).toBe(true);
      expect(schemaCache.get('/path/to/api.js')).toBeNull();
    });
  });

  describe('invalidateSchema', () => {
    it('should remove schema from cache', () => {
      const apiModule = {
        schema: ({ z }) => ({ body: z.object({}) })
      };
      
      compileSchema('/path/to/api.js', apiModule);
      expect(schemaCache.has('/path/to/api.js')).toBe(true);
      
      invalidateSchema('/path/to/api.js');
      expect(schemaCache.has('/path/to/api.js')).toBe(false);
    });

    it('should allow re-compilation after invalidation', () => {
      let callCount = 0;
      const apiModule = {
        schema: ({ z }) => {
          callCount++;
          return { body: z.object({}) };
        }
      };
      
      compileSchema('/path/to/api.js', apiModule);
      invalidateSchema('/path/to/api.js');
      compileSchema('/path/to/api.js', apiModule);
      
      expect(callCount).toBe(2);
    });
  });

  describe('clearAllSchemas', () => {
    it('should clear all cached schemas', () => {
      const apiModule1 = { schema: ({ z }) => ({ body: z.object({}) }) };
      const apiModule2 = { schema: ({ z }) => ({ query: z.object({}) }) };
      
      compileSchema('/path/to/api1.js', apiModule1);
      compileSchema('/path/to/api2.js', apiModule2);
      
      clearAllSchemas();
      
      expect(schemaCache.has('/path/to/api1.js')).toBe(false);
      expect(schemaCache.has('/path/to/api2.js')).toBe(false);
    });
  });
});



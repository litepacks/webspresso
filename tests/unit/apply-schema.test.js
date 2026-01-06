/**
 * Unit Tests for core/applySchema.js
 */

const { applySchema } = require('../../core/applySchema');
const z = require('zod');

describe('applySchema.js', () => {
  describe('applySchema', () => {
    describe('with no schema', () => {
      it('should initialize req.input with undefined values when schema is null', () => {
        const req = {
          body: { name: 'test' },
          params: { id: '123' },
          query: { page: '1' }
        };
        
        applySchema(req, null);
        
        expect(req.input).toEqual({
          body: undefined,
          params: undefined,
          query: undefined
        });
      });

      it('should initialize req.input with undefined values when schema is undefined', () => {
        const req = {
          body: { name: 'test' },
          params: { id: '123' },
          query: { page: '1' }
        };
        
        applySchema(req, undefined);
        
        expect(req.input).toEqual({
          body: undefined,
          params: undefined,
          query: undefined
        });
      });

      it('should not modify original req.body, req.params, req.query', () => {
        const originalBody = { name: 'test' };
        const originalParams = { id: '123' };
        const originalQuery = { page: '1' };
        
        const req = {
          body: originalBody,
          params: originalParams,
          query: originalQuery
        };
        
        applySchema(req, null);
        
        expect(req.body).toBe(originalBody);
        expect(req.params).toBe(originalParams);
        expect(req.query).toBe(originalQuery);
      });
    });

    describe('with body schema', () => {
      it('should parse and validate body', () => {
        const req = {
          body: { title: 'Hello World' },
          params: {},
          query: {}
        };
        
        const schema = {
          body: z.object({ title: z.string().min(3) })
        };
        
        applySchema(req, schema);
        
        expect(req.input.body).toEqual({ title: 'Hello World' });
        expect(req.input.params).toBeUndefined();
        expect(req.input.query).toBeUndefined();
      });

      it('should throw ZodError for invalid body', () => {
        const req = {
          body: { title: 'Hi' },
          params: {},
          query: {}
        };
        
        const schema = {
          body: z.object({ title: z.string().min(3) })
        };
        
        expect(() => applySchema(req, schema)).toThrow();
      });

      it('should not modify original req.body', () => {
        const originalBody = { title: 'Hello World' };
        const req = {
          body: originalBody,
          params: {},
          query: {}
        };
        
        const schema = {
          body: z.object({ title: z.string() })
        };
        
        applySchema(req, schema);
        
        expect(req.body).toBe(originalBody);
        expect(req.input.body).not.toBe(originalBody);
      });
    });

    describe('with params schema', () => {
      it('should parse and validate params', () => {
        const req = {
          body: {},
          params: { id: '123' },
          query: {}
        };
        
        const schema = {
          params: z.object({ id: z.string().uuid().or(z.string().regex(/^\d+$/)) })
        };
        
        applySchema(req, schema);
        
        expect(req.input.params).toEqual({ id: '123' });
        expect(req.input.body).toBeUndefined();
        expect(req.input.query).toBeUndefined();
      });

      it('should throw ZodError for invalid params', () => {
        const req = {
          body: {},
          params: { id: '' },
          query: {}
        };
        
        const schema = {
          params: z.object({ id: z.string().min(1) })
        };
        
        expect(() => applySchema(req, schema)).toThrow();
      });
    });

    describe('with query schema', () => {
      it('should parse and validate query', () => {
        const req = {
          body: {},
          params: {},
          query: { page: '5', limit: '10' }
        };
        
        const schema = {
          query: z.object({
            page: z.coerce.number().min(1),
            limit: z.coerce.number().max(100)
          })
        };
        
        applySchema(req, schema);
        
        expect(req.input.query).toEqual({ page: 5, limit: 10 });
        expect(req.input.body).toBeUndefined();
        expect(req.input.params).toBeUndefined();
      });

      it('should apply default values', () => {
        const req = {
          body: {},
          params: {},
          query: {}
        };
        
        const schema = {
          query: z.object({
            page: z.coerce.number().default(1),
            limit: z.coerce.number().default(20)
          })
        };
        
        applySchema(req, schema);
        
        expect(req.input.query).toEqual({ page: 1, limit: 20 });
      });

      it('should coerce string to number', () => {
        const req = {
          body: {},
          params: {},
          query: { page: '42' }
        };
        
        const schema = {
          query: z.object({ page: z.coerce.number() })
        };
        
        applySchema(req, schema);
        
        expect(req.input.query.page).toBe(42);
        expect(typeof req.input.query.page).toBe('number');
      });
    });

    describe('with complete schema', () => {
      it('should parse body, params, and query together', () => {
        const req = {
          body: { title: 'New Post', content: 'Lorem ipsum' },
          params: { userId: '42', postId: '100' },
          query: { draft: 'true' }
        };
        
        const schema = {
          body: z.object({
            title: z.string().min(1),
            content: z.string()
          }),
          params: z.object({
            userId: z.string(),
            postId: z.string()
          }),
          query: z.object({
            draft: z.string().transform(v => v === 'true')
          })
        };
        
        applySchema(req, schema);
        
        expect(req.input.body).toEqual({ title: 'New Post', content: 'Lorem ipsum' });
        expect(req.input.params).toEqual({ userId: '42', postId: '100' });
        expect(req.input.query).toEqual({ draft: true });
      });

      it('should not modify any original req properties', () => {
        const originalBody = { title: 'Test' };
        const originalParams = { id: '1' };
        const originalQuery = { page: '1' };
        
        const req = {
          body: originalBody,
          params: originalParams,
          query: originalQuery
        };
        
        const schema = {
          body: z.object({ title: z.string() }),
          params: z.object({ id: z.string() }),
          query: z.object({ page: z.coerce.number() })
        };
        
        applySchema(req, schema);
        
        expect(req.body).toBe(originalBody);
        expect(req.params).toBe(originalParams);
        expect(req.query).toBe(originalQuery);
        expect(req.query.page).toBe('1'); // Still string
        expect(req.input.query.page).toBe(1); // Parsed as number
      });
    });

    describe('error handling', () => {
      it('should throw ZodError with details for body validation failure', () => {
        const req = {
          body: { title: '' },
          params: {},
          query: {}
        };
        
        const schema = {
          body: z.object({ title: z.string().min(3) })
        };
        
        try {
          applySchema(req, schema);
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error.name).toBe('ZodError');
          expect(error.errors).toBeDefined();
          expect(error.errors[0].path).toContain('title');
        }
      });

      it('should throw on first validation error (body before params)', () => {
        const req = {
          body: { title: '' },
          params: { id: '' },
          query: {}
        };
        
        const schema = {
          body: z.object({ title: z.string().min(1) }),
          params: z.object({ id: z.string().min(1) })
        };
        
        try {
          applySchema(req, schema);
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error.errors[0].path).toContain('title');
        }
      });

      it('should throw on params validation if body passes', () => {
        const req = {
          body: { title: 'Valid' },
          params: { id: '' },
          query: {}
        };
        
        const schema = {
          body: z.object({ title: z.string().min(1) }),
          params: z.object({ id: z.string().min(1) })
        };
        
        try {
          applySchema(req, schema);
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error.errors[0].path).toContain('id');
        }
      });
    });

    describe('response schema', () => {
      it('should not apply response schema (handled elsewhere)', () => {
        const req = {
          body: {},
          params: {},
          query: {}
        };
        
        const schema = {
          response: z.object({ success: z.boolean() })
        };
        
        applySchema(req, schema);
        
        // Response schema should be ignored
        expect(req.input.response).toBeUndefined();
      });
    });

    describe('edge cases', () => {
      it('should handle empty objects', () => {
        const req = {
          body: {},
          params: {},
          query: {}
        };
        
        const schema = {
          body: z.object({}),
          params: z.object({}),
          query: z.object({})
        };
        
        applySchema(req, schema);
        
        expect(req.input.body).toEqual({});
        expect(req.input.params).toEqual({});
        expect(req.input.query).toEqual({});
      });

      it('should handle optional fields', () => {
        const req = {
          body: { required: 'value' },
          params: {},
          query: {}
        };
        
        const schema = {
          body: z.object({
            required: z.string(),
            optional: z.string().optional()
          })
        };
        
        applySchema(req, schema);
        
        expect(req.input.body).toEqual({ required: 'value' });
        expect(req.input.body.optional).toBeUndefined();
      });

      it('should strip unknown fields with strict schema', () => {
        const req = {
          body: { title: 'Test', extra: 'should be stripped' },
          params: {},
          query: {}
        };
        
        const schema = {
          body: z.object({ title: z.string() }).strict()
        };
        
        expect(() => applySchema(req, schema)).toThrow();
      });

      it('should handle arrays in body', () => {
        const req = {
          body: { items: [1, 2, 3] },
          params: {},
          query: {}
        };
        
        const schema = {
          body: z.object({ items: z.array(z.number()) })
        };
        
        applySchema(req, schema);
        
        expect(req.input.body.items).toEqual([1, 2, 3]);
      });

      it('should handle nested objects', () => {
        const req = {
          body: {
            user: {
              name: 'John',
              address: {
                city: 'Istanbul'
              }
            }
          },
          params: {},
          query: {}
        };
        
        const schema = {
          body: z.object({
            user: z.object({
              name: z.string(),
              address: z.object({
                city: z.string()
              })
            })
          })
        };
        
        applySchema(req, schema);
        
        expect(req.input.body.user.name).toBe('John');
        expect(req.input.body.user.address.city).toBe('Istanbul');
      });
    });
  });
});


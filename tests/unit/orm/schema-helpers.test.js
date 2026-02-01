/**
 * Schema Helpers Unit Tests
 */

const { z } = require('zod');
const {
  createSchemaHelpers,
  encodeColumnMeta,
  decodeColumnMeta,
  hasColumnMeta,
  getColumnMeta,
  extractColumnsFromSchema,
  METADATA_MARKER,
} = require('../../../core/orm/schema-helpers');

describe('Schema Helpers', () => {
  describe('encodeColumnMeta / decodeColumnMeta', () => {
    it('should encode and decode column metadata', () => {
      const meta = { type: 'string', maxLength: 255, nullable: false };
      const encoded = encodeColumnMeta(meta);
      const decoded = decodeColumnMeta(encoded);
      
      expect(decoded).toEqual(meta);
    });

    it('should return null for invalid encoded data', () => {
      expect(decodeColumnMeta(null)).toBeNull();
      expect(decodeColumnMeta('')).toBeNull();
      expect(decodeColumnMeta('invalid json')).toBeNull();
      expect(decodeColumnMeta(JSON.stringify({ foo: 'bar' }))).toBeNull();
    });

    it('should include metadata marker', () => {
      const meta = { type: 'integer' };
      const encoded = encodeColumnMeta(meta);
      const parsed = JSON.parse(encoded);
      
      expect(parsed[METADATA_MARKER]).toBe(true);
    });
  });

  describe('createSchemaHelpers', () => {
    const zdb = createSchemaHelpers(z);

    describe('id()', () => {
      it('should create a primary key column', () => {
        const schema = zdb.id();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('bigint');
        expect(meta.primary).toBe(true);
        expect(meta.autoIncrement).toBe(true);
      });
    });

    describe('uuid()', () => {
      it('should create a UUID primary key column', () => {
        const schema = zdb.uuid();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('uuid');
        expect(meta.primary).toBe(true);
      });
    });

    describe('string()', () => {
      it('should create a string column with default maxLength', () => {
        const schema = zdb.string();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('string');
        expect(meta.maxLength).toBe(255);
        expect(meta.nullable).toBe(false);
      });

      it('should accept custom options', () => {
        const schema = zdb.string({ maxLength: 100, unique: true, index: true });
        const meta = getColumnMeta(schema);
        
        expect(meta.maxLength).toBe(100);
        expect(meta.unique).toBe(true);
        expect(meta.index).toBe(true);
      });

      it('should handle nullable', () => {
        const schema = zdb.string({ nullable: true });
        const meta = getColumnMeta(schema);
        
        expect(meta.nullable).toBe(true);
      });
    });

    describe('text()', () => {
      it('should create a text column', () => {
        const schema = zdb.text();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('text');
      });
    });

    describe('integer()', () => {
      it('should create an integer column', () => {
        const schema = zdb.integer();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('integer');
      });
    });

    describe('bigint()', () => {
      it('should create a bigint column', () => {
        const schema = zdb.bigint();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('bigint');
      });
    });

    describe('float()', () => {
      it('should create a float column', () => {
        const schema = zdb.float();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('float');
      });
    });

    describe('decimal()', () => {
      it('should create a decimal column with precision and scale', () => {
        const schema = zdb.decimal({ precision: 8, scale: 4 });
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('decimal');
        expect(meta.precision).toBe(8);
        expect(meta.scale).toBe(4);
      });

      it('should use defaults for precision and scale', () => {
        const schema = zdb.decimal();
        const meta = getColumnMeta(schema);
        
        expect(meta.precision).toBe(10);
        expect(meta.scale).toBe(2);
      });
    });

    describe('boolean()', () => {
      it('should create a boolean column', () => {
        const schema = zdb.boolean();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('boolean');
      });

      it('should accept default value', () => {
        const schema = zdb.boolean({ default: true });
        const meta = getColumnMeta(schema);
        
        expect(meta.default).toBe(true);
      });
    });

    describe('timestamp()', () => {
      it('should create a timestamp column', () => {
        const schema = zdb.timestamp();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('timestamp');
      });

      it('should support auto create', () => {
        const schema = zdb.timestamp({ auto: 'create' });
        const meta = getColumnMeta(schema);
        
        expect(meta.auto).toBe('create');
        expect(meta.nullable).toBe(true); // Auto timestamps should be nullable in schema
      });

      it('should support auto update', () => {
        const schema = zdb.timestamp({ auto: 'update' });
        const meta = getColumnMeta(schema);
        
        expect(meta.auto).toBe('update');
      });
    });

    describe('enum()', () => {
      it('should create an enum column', () => {
        const schema = zdb.enum(['active', 'inactive']);
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('enum');
        expect(meta.enumValues).toEqual(['active', 'inactive']);
      });

      it('should accept default value', () => {
        const schema = zdb.enum(['a', 'b'], { default: 'a' });
        const meta = getColumnMeta(schema);
        
        expect(meta.default).toBe('a');
      });
    });

    describe('foreignKey()', () => {
      it('should create a foreign key column', () => {
        const schema = zdb.foreignKey('users');
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('bigint');
        expect(meta.references).toBe('users');
        expect(meta.referenceColumn).toBe('id');
      });

      it('should accept custom reference column', () => {
        const schema = zdb.foreignKey('users', { referenceColumn: 'uuid' });
        const meta = getColumnMeta(schema);
        
        expect(meta.referenceColumn).toBe('uuid');
      });
    });

    describe('foreignUuid()', () => {
      it('should create a UUID foreign key column', () => {
        const schema = zdb.foreignUuid('users');
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('uuid');
        expect(meta.references).toBe('users');
      });
    });

    describe('json()', () => {
      it('should create a JSON column', () => {
        const schema = zdb.json();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('json');
      });
    });

    describe('array()', () => {
      it('should create an array column with default item schema', () => {
        const schema = zdb.array();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('array');
        expect(meta.nullable).toBe(false);
        // Should be a ZodArray
        expect(schema._def.typeName).toBe('ZodArray');
      });

      it('should create an array column with custom item schema', () => {
        const schema = zdb.array(z.string());
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('array');
        // Should validate array of strings
        expect(() => schema.parse(['a', 'b', 'c'])).not.toThrow();
        expect(() => schema.parse([1, 2, 3])).toThrow();
      });

      it('should accept options object as first argument', () => {
        const schema = zdb.array({ nullable: true });
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('array');
        expect(meta.nullable).toBe(true);
      });

      it('should handle nullable arrays', () => {
        const schema = zdb.array(z.number(), { nullable: true });
        const meta = getColumnMeta(schema);
        
        expect(meta.nullable).toBe(true);
        expect(() => schema.parse(null)).not.toThrow();
        expect(() => schema.parse(undefined)).not.toThrow();
      });

      it('should validate array items correctly', () => {
        const schema = zdb.array(z.number());
        
        expect(() => schema.parse([1, 2, 3])).not.toThrow();
        expect(() => schema.parse(['a', 'b'])).toThrow();
        expect(() => schema.parse('not an array')).toThrow();
      });
    });
  });

  describe('extractColumnsFromSchema', () => {
    it('should extract all column metadata from schema', () => {
      const zdb = createSchemaHelpers(z);
      const schema = z.object({
        id: zdb.id(),
        name: zdb.string(),
        email: zdb.string({ unique: true }),
      });

      const columns = extractColumnsFromSchema(schema);
      
      expect(columns.size).toBe(3);
      expect(columns.get('id').primary).toBe(true);
      expect(columns.get('name').type).toBe('string');
      expect(columns.get('email').unique).toBe(true);
    });
  });

  describe('hasColumnMeta', () => {
    it('should return true for schemas with metadata', () => {
      const zdb = createSchemaHelpers(z);
      const schema = zdb.string();
      
      expect(hasColumnMeta(schema)).toBe(true);
    });

    it('should return false for plain zod schemas', () => {
      const schema = z.string();
      
      expect(hasColumnMeta(schema)).toBe(false);
    });
  });
});


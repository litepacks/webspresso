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

    describe('schema()', () => {
      it('should create a Zod object schema', () => {
        const schema = zdb.schema({
          id: zdb.id(),
          name: zdb.string(),
        });
        
        expect(schema.parse).toBeDefined();
        expect(typeof schema.parse).toBe('function');
        
        const result = schema.parse({ id: 1, name: 'test' });
        expect(result.id).toBe(1);
        expect(result.name).toBe('test');
      });

      it('should work with array fields', () => {
        const schema = zdb.schema({
          id: zdb.id(),
          tags: zdb.array(z.string()),
        });
        
        const result = schema.parse({ id: 1, tags: ['tag1', 'tag2'] });
        expect(result.tags).toEqual(['tag1', 'tag2']);
      });
    });

    describe('id()', () => {
      it('should create a primary key column', () => {
        const builder = zdb.id();
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('bigint');
        expect(meta.primary).toBe(true);
        expect(meta.autoIncrement).toBe(true);
      });
    });

    describe('uuid()', () => {
      it('should create a UUID primary key column', () => {
        const builder = zdb.uuid();
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('uuid');
        expect(meta.primary).toBe(true);
      });
    });

    describe('nanoid()', () => {
      it('should create a nanoid primary key column', () => {
        const builder = zdb.nanoid();
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('nanoid');
        expect(meta.primary).toBe(true);
        expect(meta.maxLength).toBe(21);
      });

      it('should accept custom maxLength', () => {
        const builder = zdb.nanoid({ maxLength: 12 });
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        expect(meta.maxLength).toBe(12);
      });
    });

    describe('string()', () => {
      it('should create a string column with default maxLength', () => {
        const builder = zdb.string();
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('string');
        expect(meta.maxLength).toBe(255);
        expect(meta.nullable).toBe(false);
      });

      it('should accept custom options', () => {
        const builder = zdb.string({ maxLength: 100, unique: true, index: true });
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.maxLength).toBe(100);
        expect(meta.unique).toBe(true);
        expect(meta.index).toBe(true);
      });

      it('should handle nullable', () => {
        const builder = zdb.string({ nullable: true });
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.nullable).toBe(true);
      });
    });

    describe('text()', () => {
      it('should create a text column', () => {
        const builder = zdb.text();
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('text');
      });
    });

    describe('file()', () => {
      it('should create a file column storing URL/path string', () => {
        const builder = zdb.file();
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);

        expect(meta.type).toBe('file');
        expect(meta.maxLength).toBe(2048);
        expect(schema.parse('/uploads/x.png')).toBe('/uploads/x.png');
      });
    });

    describe('files()', () => {
      it('should create a files column storing array of URL/path strings', () => {
        const builder = zdb.files();
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);

        expect(meta.type).toBe('files');
        expect(schema.parse(['/uploads/a.png', '/uploads/b.png'])).toEqual(['/uploads/a.png', '/uploads/b.png']);
      });
    });

    describe('integer()', () => {
      it('should create an integer column', () => {
        const builder = zdb.integer();
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('integer');
      });
    });

    describe('bigint()', () => {
      it('should create a bigint column', () => {
        const builder = zdb.bigint();
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('bigint');
      });
    });

    describe('float()', () => {
      it('should create a float column', () => {
        const builder = zdb.float();
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('float');
      });
    });

    describe('decimal()', () => {
      it('should create a decimal column with precision and scale', () => {
        const builder = zdb.decimal({ precision: 8, scale: 4 });
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('decimal');
        expect(meta.precision).toBe(8);
        expect(meta.scale).toBe(4);
      });

      it('should use defaults for precision and scale', () => {
        const builder = zdb.decimal();
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.precision).toBe(10);
        expect(meta.scale).toBe(2);
      });
    });

    describe('boolean()', () => {
      it('should create a boolean column', () => {
        const builder = zdb.boolean();
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('boolean');
      });

      it('should accept default value', () => {
        const builder = zdb.boolean({ default: true });
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.default).toBe(true);
      });

      it('should coerce numeric 0/1 to boolean (SQLite compatibility)', () => {
        const builder = zdb.boolean();
        const schema = builder._finalize();
        
        // SQLite stores boolean as 0/1
        expect(schema.parse(0)).toBe(false);
        expect(schema.parse(1)).toBe(true);
        
        // Should also work with actual booleans
        expect(schema.parse(false)).toBe(false);
        expect(schema.parse(true)).toBe(true);
      });

      it('should coerce string values to boolean', () => {
        const builder = zdb.boolean();
        const schema = builder._finalize();
        
        // String values from form submissions
        expect(schema.parse('0')).toBe(false);
        expect(schema.parse('1')).toBe(true);
        expect(schema.parse('false')).toBe(false);
        expect(schema.parse('true')).toBe(true);
      });

      it('should handle nullable boolean with numeric values', () => {
        const builder = zdb.boolean({ nullable: true });
        const schema = builder._finalize();
        
        expect(schema.parse(null)).toBe(null);
        expect(schema.parse(0)).toBe(false);
        expect(schema.parse(1)).toBe(true);
      });
    });

    describe('timestamp()', () => {
      it('should create a timestamp column', () => {
        const builder = zdb.timestamp();
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('timestamp');
      });

      it('should support auto create', () => {
        const builder = zdb.timestamp({ auto: 'create' });
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.auto).toBe('create');
        expect(meta.nullable).toBe(true); // Auto timestamps should be nullable in schema
      });

      it('should support auto update', () => {
        const builder = zdb.timestamp({ auto: 'update' });
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.auto).toBe('update');
      });
    });

    describe('enum()', () => {
      it('should create an enum column', () => {
        const builder = zdb.enum(['active', 'inactive']);
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('enum');
        expect(meta.enumValues).toEqual(['active', 'inactive']);
      });

      it('should accept default value', () => {
        const builder = zdb.enum(['a', 'b'], { default: 'a' });
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.default).toBe('a');
      });
    });

    describe('foreignKey()', () => {
      it('should create a foreign key column', () => {
        const builder = zdb.foreignKey('users');
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('bigint');
        expect(meta.references).toBe('users');
        expect(meta.referenceColumn).toBe('id');
      });

      it('should accept custom reference column', () => {
        const builder = zdb.foreignKey('users', { referenceColumn: 'uuid' });
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.referenceColumn).toBe('uuid');
      });
    });

    describe('foreignUuid()', () => {
      it('should create a UUID foreign key column', () => {
        const builder = zdb.foreignUuid('users');
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('uuid');
        expect(meta.references).toBe('users');
      });
    });

    describe('foreignNanoid()', () => {
      it('should create a nanoid foreign key column', () => {
        const builder = zdb.foreignNanoid('posts');
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('nanoid');
        expect(meta.references).toBe('posts');
        expect(meta.maxLength).toBe(21);
      });
    });

    describe('json()', () => {
      it('should create a JSON column', () => {
        const builder = zdb.json();
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('json');
      });
    });

    describe('array()', () => {
      it('should create an array column with default item schema', () => {
        const builder = zdb.array();
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('array');
        expect(meta.nullable).toBe(false);
        // Should be a ZodArray
        expect(schema._def.typeName).toBe('ZodArray');
      });

      it('should create an array column with custom item schema', () => {
        const builder = zdb.array(z.string());
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('array');
        // Should validate array of strings
        expect(() => schema.parse(['a', 'b', 'c'])).not.toThrow();
        expect(() => schema.parse([1, 2, 3])).toThrow();
      });

      it('should accept options object as first argument', () => {
        const builder = zdb.array({ nullable: true });
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.type).toBe('array');
        expect(meta.nullable).toBe(true);
      });

      it('should handle nullable arrays', () => {
        const builder = zdb.array(z.number(), { nullable: true });
        const schema = builder._finalize();
        const meta = getColumnMeta(schema);
        
        expect(meta.nullable).toBe(true);
        expect(() => schema.parse(null)).not.toThrow();
        expect(() => schema.parse(undefined)).not.toThrow();
      });

      it('should validate array items correctly', () => {
        const builder = zdb.array(z.number());
        const schema = builder._finalize();
        
        expect(() => schema.parse([1, 2, 3])).not.toThrow();
        expect(() => schema.parse(['a', 'b'])).toThrow();
        expect(() => schema.parse('not an array')).toThrow();
      });
    });
  });

  describe('extractColumnsFromSchema', () => {
    it('should extract all column metadata from schema', () => {
      const zdb = createSchemaHelpers(z);
      const schema = zdb.schema({
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
      const schema = zdb.string()._finalize();
      
      expect(hasColumnMeta(schema)).toBe(true);
    });

    it('should return false for plain zod schemas', () => {
      const schema = z.string();
      
      expect(hasColumnMeta(schema)).toBe(false);
    });
  });

  describe('Chainable Validation API', () => {
    const zdb = createSchemaHelpers(z);

    it('should support chained validations', () => {
      const schema = zdb.schema({
        email: zdb.string().min(3).max(100).email(),
        age: zdb.integer().min(18).max(120),
        price: zdb.decimal().min(0).step(0.01),
      });

      // Should validate correctly
      expect(() => schema.parse({ email: 'test@example.com', age: 25, price: 10.50 })).not.toThrow();
      expect(() => schema.parse({ email: 'ab', age: 15, price: -5 })).toThrow();
    });

    it('should store validation metadata', () => {
      const emailField = zdb.string().min(3).max(100).email();
      const finalized = emailField._finalize();
      const meta = getColumnMeta(finalized);

      expect(meta.validations).toBeDefined();
      expect(meta.validations.min).toBe(3);
      expect(meta.validations.max).toBe(100);
      expect(meta.validations.email).toBe(true);
    });

    it('should support UI config', () => {
      const emailField = zdb.string().email().config({
        label: 'Email Address',
        placeholder: 'your@email.com',
        hint: 'Enter your work email',
      });
      const finalized = emailField._finalize();
      const meta = getColumnMeta(finalized);

      expect(meta.ui).toBeDefined();
      expect(meta.ui.label).toBe('Email Address');
      expect(meta.ui.placeholder).toBe('your@email.com');
      expect(meta.ui.hint).toBe('Enter your work email');
    });

    it('should support combined validations and UI config', () => {
      const field = zdb.string().min(3).max(100).email().config({
        label: 'Email',
        placeholder: 'email@example.com',
      });
      const finalized = field._finalize();
      const meta = getColumnMeta(finalized);

      expect(meta.validations.email).toBe(true);
      expect(meta.validations.min).toBe(3);
      expect(meta.validations.max).toBe(100);
      expect(meta.ui.label).toBe('Email');
      expect(meta.ui.placeholder).toBe('email@example.com');
    });

    it('should auto-finalize in zdb.schema()', () => {
      const schema = zdb.schema({
        email: zdb.string().min(3).email().config({ label: 'Email' }),
        age: zdb.integer().min(18).config({ label: 'Age' }),
      });

      // Should work without manual finalize
      expect(() => schema.parse({ email: 'test@example.com', age: 25 })).not.toThrow();
      
      // Metadata should be preserved
      const columns = extractColumnsFromSchema(schema);
      expect(columns.get('email').validations.email).toBe(true);
      expect(columns.get('email').ui.label).toBe('Email');
      expect(columns.get('age').validations.min).toBe(18);
      expect(columns.get('age').ui.label).toBe('Age');
    });

    it('should support nullable and optional chaining', () => {
      const field = zdb.string().min(3).nullable().config({ label: 'Optional Field' });
      const finalized = field._finalize();
      const meta = getColumnMeta(finalized);

      expect(meta.nullable).toBe(true);
    });

    it('should support pattern validation', () => {
      const field = zdb.string().pattern(/^\+?[0-9]{10,14}$/).config({ label: 'Phone' });
      const finalized = field._finalize();
      const meta = getColumnMeta(finalized);

      expect(meta.validations.pattern).toBe('^\\+?[0-9]{10,14}$');
    });

    it('should support step for numbers', () => {
      const field = zdb.decimal().step(0.01).config({ label: 'Price' });
      const finalized = field._finalize();
      const meta = getColumnMeta(finalized);

      expect(meta.validations.step).toBe(0.01);
    });

    it('should cover all SchemaBuilder validation methods', () => {
      const b1 = zdb.string()
        .length(10)
        .minLength(5)
        .maxLength(20)
        .url()
        .includes('foo')
        .startsWith('bar')
        .endsWith('baz')
        .nonempty()
        .optional();

      const finalized1 = b1._finalize();
      expect(b1._finalize()).toBe(finalized1); // test already finalized branch

      const meta1 = getColumnMeta(finalized1);
      expect(meta1.validations.length).toBe(10);
      expect(meta1.validations.minLength).toBe(5);
      expect(meta1.validations.maxLength).toBe(20);
      expect(meta1.validations.url).toBe(true);
      expect(meta1.validations.includes).toBe('foo');
      expect(meta1.validations.startsWith).toBe('bar');
      expect(meta1.validations.endsWith).toBe('baz');
      expect(meta1.validations.nonempty).toBe(true);

      const bNum = zdb.float()
        .positive()
        .negative()
        .int();
      const metaNum = getColumnMeta(bNum._finalize());
      expect(metaNum.validations.positive).toBe(true);
      expect(metaNum.validations.negative).toBe(true);
      expect(metaNum.validations.int).toBe(true);

      // nonempty with object/array
      const bArr = zdb.array(z.string()).nonempty();
      const metaArr = getColumnMeta(bArr._finalize());
      expect(metaArr.validations.nonempty).toBe(true);
    });

    it('should cover all config UI options', () => {
      const b = zdb.text().config({
        hint: 'Some hint',
        inputType: 'textarea',
        hidden: true,
        readonly: true,
        width: '50%',
        rows: 5,
        sortable: false,
      });
      const meta = getColumnMeta(b._finalize());
      expect(meta.ui.hint).toBe('Some hint');
      expect(meta.ui.inputType).toBe('textarea');
      expect(meta.ui.hidden).toBe(true);
      expect(meta.ui.readonly).toBe(true);
      expect(meta.ui.width).toBe('50%');
      expect(meta.ui.rows).toBe(5);
      expect(meta.ui.sortable).toBe(false);
    });

    it('should test proxy handler and unknown method error', () => {
      const b = zdb.string();
      expect(() => b._proxyMethod('nonExistentMethodXYZ', [])).toThrow(/Method nonExistentMethodXYZ is not available/);
    });

    it('should cover all column types: files, bigint, float, date, datetime, timestamp, json, array, enum, foreign keys', () => {
      const sFiles = zdb.files({ nullable: true })._finalize();
      expect(getColumnMeta(sFiles).type).toBe('files');
      expect(getColumnMeta(sFiles).nullable).toBe(true);

      const sBig = zdb.bigint({ nullable: true })._finalize();
      expect(getColumnMeta(sBig).type).toBe('bigint');

      const sFloat = zdb.float({ nullable: true })._finalize();
      expect(getColumnMeta(sFloat).type).toBe('float');

      const sDate = zdb.date({ nullable: true })._finalize();
      expect(getColumnMeta(sDate).type).toBe('date');

      const sDateTime = zdb.datetime({ nullable: true })._finalize();
      expect(getColumnMeta(sDateTime).type).toBe('datetime');

      const sTs = zdb.timestamp({ auto: 'create' })._finalize();
      expect(getColumnMeta(sTs).type).toBe('timestamp');
      expect(getColumnMeta(sTs).auto).toBe('create');

      const sJson = zdb.json({ nullable: true })._finalize();
      expect(getColumnMeta(sJson).type).toBe('json');

      // array with first arg options
      const sArrOpts = zdb.array({ nullable: true })._finalize();
      expect(getColumnMeta(sArrOpts).type).toBe('array');

      // enum with default
      const sEnum = zdb.enum(['a', 'b'], { default: 'a', nullable: true })._finalize();
      expect(getColumnMeta(sEnum).default).toBe('a');
      expect(getColumnMeta(sEnum).nullable).toBe(true);

      // foreign keys
      const sFk = zdb.foreignKey('users', { nullable: true, referenceColumn: 'user_id' })._finalize();
      expect(getColumnMeta(sFk).references).toBe('users');
      expect(getColumnMeta(sFk).referenceColumn).toBe('user_id');

      const sFkUuid = zdb.foreignUuid('users', { nullable: true })._finalize();
      expect(getColumnMeta(sFkUuid).type).toBe('uuid');

      const sFkNano = zdb.foreignNanoid('users', { nullable: true, maxLength: 16 })._finalize();
      expect(getColumnMeta(sFkNano).type).toBe('nanoid');
      expect(getColumnMeta(sFkNano).maxLength).toBe(16);
    });

    it('should preprocess boolean correctly for 0, 1, "0", "1", "false", "true"', () => {
      const boolBuilder = zdb.boolean({ default: false, nullable: true });
      const schema = boolBuilder._finalize();

      expect(schema.parse(0)).toBe(false);
      expect(schema.parse(1)).toBe(true);
      expect(schema.parse('0')).toBe(false);
      expect(schema.parse('1')).toBe(true);
      expect(schema.parse('false')).toBe(false);
      expect(schema.parse('true')).toBe(true);
      expect(schema.parse(false)).toBe(false);
      expect(schema.parse(true)).toBe(true);
    });

    it('should test decodeColumnMeta caching and hasColumnMeta with _wdbMeta', () => {
      const meta = { type: 'string' };
      const encoded = encodeColumnMeta(meta);
      // first call sets cache
      expect(decodeColumnMeta(encoded)).toEqual(meta);
      // second call hits cache
      expect(decodeColumnMeta(encoded)).toEqual(meta);

      const fakeSchema = { _wdbMeta: { type: 'custom' } };
      expect(hasColumnMeta(fakeSchema)).toBe(true);
      expect(getColumnMeta(fakeSchema)).toEqual({ type: 'custom' });
    });

    it('should test extractColumnsFromSchema edge cases', () => {
      expect(extractColumnsFromSchema(null).size).toBe(0);
      expect(extractColumnsFromSchema({}).size).toBe(0);

      const schema = zdb.schema({
        unfinalized: zdb.string().min(2),
        plain: z.string(),
      });
      // First call computes
      const cols1 = extractColumnsFromSchema(schema);
      expect(cols1.has('unfinalized')).toBe(true);
      // Second call hits weakmap cache
      const cols2 = extractColumnsFromSchema(schema);
      expect(cols2).toBe(cols1);
    });
  });
});



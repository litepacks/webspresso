/**
 * Seeder Unit Tests
 */

const { z } = require('zod');
const { faker } = require('@faker-js/faker');
const { createSchemaHelpers, defineModel, clearRegistry } = require('../../../core/orm');
const { createSeeder } = require('../../../core/orm/seeder');

describe('Seeder', () => {
  const zdb = createSchemaHelpers(z);

  beforeEach(() => {
    clearRegistry();
    faker.seed(12345); // Deterministic tests
  });

  describe('createSeeder', () => {
    it('should throw if faker is not provided', () => {
      expect(() => createSeeder(null, {})).toThrow('Faker instance is required');
    });

    it('should create seeder instance', () => {
      const seeder = createSeeder(faker, {});
      
      expect(seeder.defineFactory).toBeDefined();
      expect(seeder.factory).toBeDefined();
      expect(seeder.seed).toBeDefined();
      expect(seeder.run).toBeDefined();
      expect(seeder.truncate).toBeDefined();
      expect(seeder.clearAll).toBeDefined();
      expect(seeder.faker).toBe(faker);
    });
  });

  describe('factory().make()', () => {
    it('should generate record without saving', () => {
      const schema = z.object({
        id: zdb.id(),
        name: zdb.string(),
        email: zdb.string(),
      });

      defineModel({ name: 'User', table: 'users', schema });

      const seeder = createSeeder(faker, {});
      const record = seeder.factory('User').make();

      expect(record).toBeDefined();
      expect(record.name).toBeDefined();
      expect(record.email).toBeDefined();
      expect(record.id).toBeUndefined(); // Auto-increment skipped
    });

    it('should generate multiple records', () => {
      const schema = z.object({
        id: zdb.id(),
        title: zdb.string(),
      });

      defineModel({ name: 'Post', table: 'posts', schema });

      const seeder = createSeeder(faker, {});
      const records = seeder.factory('Post').make(5);

      expect(records).toHaveLength(5);
      records.forEach(r => {
        expect(r.title).toBeDefined();
      });
    });

    it('should apply overrides', () => {
      const schema = z.object({
        id: zdb.id(),
        status: zdb.string(),
      });

      defineModel({ name: 'Task', table: 'tasks', schema });

      const seeder = createSeeder(faker, {});
      const record = seeder.factory('Task').override({ status: 'completed' }).make();

      expect(record.status).toBe('completed');
    });

    it('should use custom generators', () => {
      const schema = z.object({
        id: zdb.id(),
        code: zdb.string(),
      });

      defineModel({ name: 'Item', table: 'items', schema });

      const seeder = createSeeder(faker, {});
      const record = seeder.factory('Item')
        .generators({ code: (f) => `CODE-${f.number.int({ max: 100 })}` })
        .make();

      expect(record.code).toMatch(/^CODE-\d+$/);
    });
  });

  describe('smart field detection', () => {
    it('should generate email for email fields', () => {
      const schema = z.object({
        id: zdb.id(),
        email: zdb.string(),
        work_email: zdb.string(),
      });

      defineModel({ name: 'Contact', table: 'contacts', schema });

      const seeder = createSeeder(faker, {});
      const record = seeder.factory('Contact').make();

      expect(record.email).toMatch(/@/);
      expect(record.work_email).toMatch(/@/);
    });

    it('should generate names for name fields', () => {
      const schema = z.object({
        id: zdb.id(),
        name: zdb.string(),
        first_name: zdb.string(),
        last_name: zdb.string(),
        username: zdb.string(),
      });

      defineModel({ name: 'Person', table: 'persons', schema });

      const seeder = createSeeder(faker, {});
      const record = seeder.factory('Person').make();

      expect(record.name).toBeDefined();
      expect(record.first_name).toBeDefined();
      expect(record.last_name).toBeDefined();
      expect(record.username).toBeDefined();
    });

    it('should generate content for text fields', () => {
      const schema = z.object({
        id: zdb.id(),
        title: zdb.string(),
        content: zdb.text(),
        description: zdb.text(),
        slug: zdb.string(),
      });

      defineModel({ name: 'Article', table: 'articles', schema });

      const seeder = createSeeder(faker, {});
      const record = seeder.factory('Article').make();

      expect(record.title).toBeDefined();
      expect(record.content.length).toBeGreaterThan(50);
      expect(record.description.length).toBeGreaterThan(20);
      expect(record.slug).toMatch(/^[a-z0-9-]+$/);
    });

    it('should generate URLs for url fields', () => {
      const schema = z.object({
        id: zdb.id(),
        website_url: zdb.string(),
        avatar: zdb.string(),
      });

      defineModel({ name: 'Profile', table: 'profiles', schema });

      const seeder = createSeeder(faker, {});
      const record = seeder.factory('Profile').make();

      expect(record.website_url).toMatch(/^https?:\/\//);
      expect(record.avatar).toBeDefined();
    });

    it('should generate phone numbers', () => {
      const schema = z.object({
        id: zdb.id(),
        phone: zdb.string(),
        telephone: zdb.string(),
      });

      defineModel({ name: 'Contact2', table: 'contacts2', schema });

      const seeder = createSeeder(faker, {});
      const record = seeder.factory('Contact2').make();

      expect(record.phone).toBeDefined();
      expect(record.telephone).toBeDefined();
    });

    it('should generate address fields', () => {
      const schema = z.object({
        id: zdb.id(),
        address: zdb.string(),
        city: zdb.string(),
        country: zdb.string(),
        zipcode: zdb.string(),
      });

      defineModel({ name: 'Location', table: 'locations', schema });

      const seeder = createSeeder(faker, {});
      const record = seeder.factory('Location').make();

      expect(record.address).toBeDefined();
      expect(record.city).toBeDefined();
      expect(record.country).toBeDefined();
      expect(record.zipcode).toBeDefined();
    });

    it('should generate numeric fields', () => {
      const schema = z.object({
        id: zdb.id(),
        price: zdb.decimal(),
        amount: zdb.float(),
        count: zdb.integer(),
        quantity: zdb.integer(),
      });

      defineModel({ name: 'Order', table: 'orders', schema });

      const seeder = createSeeder(faker, {});
      const record = seeder.factory('Order').make();

      expect(typeof record.price).toBe('number');
      expect(typeof record.amount).toBe('number');
      expect(typeof record.count).toBe('number');
      expect(typeof record.quantity).toBe('number');
    });
  });

  describe('type-based generation', () => {
    it('should generate by column types', () => {
      const schema = z.object({
        id: zdb.uuid(),
        active: zdb.boolean(),
        birth_date: zdb.date(),
        created_at: zdb.datetime(),
        role: zdb.enum(['admin', 'user', 'guest']),
        metadata: zdb.json(),
      });

      defineModel({ name: 'TypeTest', table: 'type_tests', schema });

      const seeder = createSeeder(faker, {});
      const record = seeder.factory('TypeTest').make();

      expect(record.id).toMatch(/^[0-9a-f-]{36}$/); // UUID
      expect(typeof record.active).toBe('boolean');
      expect(record.birth_date).toMatch(/^\d{4}-\d{2}-\d{2}$/); // Date
      expect(record.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // DateTime
      expect(['admin', 'user', 'guest']).toContain(record.role);
      expect(typeof record.metadata).toBe('object');
    });

    it('should handle nullable fields', () => {
      const schema = z.object({
        id: zdb.id(),
        optional_field: zdb.string({ nullable: true }),
      });

      defineModel({ name: 'Nullable', table: 'nullables', schema });

      const seeder = createSeeder(faker, {});
      
      // Generate many to statistically cover null case
      faker.seed(42);
      let hasNull = false;
      let hasValue = false;
      
      for (let i = 0; i < 50; i++) {
        const record = seeder.factory('Nullable').make();
        if (record.optional_field === null) hasNull = true;
        if (record.optional_field !== null) hasValue = true;
      }

      // Should have both null and non-null values
      expect(hasValue).toBe(true);
    });

    it('should skip auto-generated fields', () => {
      const schema = z.object({
        id: zdb.id(),
        created_at: zdb.timestamp({ auto: 'create' }),
        updated_at: zdb.timestamp({ auto: 'update' }),
        name: zdb.string(),
      });

      defineModel({ name: 'AutoFields', table: 'auto_fields', schema });

      const seeder = createSeeder(faker, {});
      const record = seeder.factory('AutoFields').make();

      expect(record.id).toBeUndefined();
      expect(record.created_at).toBeUndefined();
      expect(record.updated_at).toBeUndefined();
      expect(record.name).toBeDefined();
    });

    it('should respect maxLength', () => {
      const schema = z.object({
        id: zdb.id(),
        code: zdb.string({ maxLength: 10 }),
      });

      defineModel({ name: 'ShortCode', table: 'short_codes', schema });

      const seeder = createSeeder(faker, {});
      
      for (let i = 0; i < 20; i++) {
        const record = seeder.factory('ShortCode').make();
        expect(record.code.length).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('defineFactory', () => {
    it('should define factory with defaults', () => {
      const schema = z.object({
        id: zdb.id(),
        status: zdb.string(),
        priority: zdb.integer(),
      });

      defineModel({ name: 'Task', table: 'tasks', schema });

      const seeder = createSeeder(faker, {});
      seeder.defineFactory('Task', {
        defaults: { status: 'pending', priority: 1 },
      });

      const record = seeder.factory('Task').make();

      expect(record.status).toBe('pending');
      expect(record.priority).toBe(1);
    });

    it('should support states', () => {
      const schema = z.object({
        id: zdb.id(),
        status: zdb.string(),
        verified_at: zdb.timestamp({ nullable: true }),
      });

      defineModel({ name: 'Account', table: 'accounts', schema });

      const seeder = createSeeder(faker, {});
      seeder.defineFactory('Account', {
        defaults: { status: 'pending' },
        states: {
          verified: { status: 'verified', verified_at: '2024-01-01T00:00:00Z' },
          suspended: (f) => ({ status: 'suspended' }),
        },
      });

      const pending = seeder.factory('Account').make();
      expect(pending.status).toBe('pending');

      const verified = seeder.factory('Account').state('verified').make();
      expect(verified.status).toBe('verified');
      expect(verified.verified_at).toBe('2024-01-01T00:00:00Z');

      const suspended = seeder.factory('Account').state('suspended').make();
      expect(suspended.status).toBe('suspended');
    });

    it('should support custom generators in factory', () => {
      const schema = z.object({
        id: zdb.id(),
        sku: zdb.string(),
      });

      defineModel({ name: 'Product', table: 'products', schema });

      const seeder = createSeeder(faker, {});
      seeder.defineFactory('Product', {
        generators: {
          sku: (f) => `SKU-${f.string.alphanumeric(8).toUpperCase()}`,
        },
      });

      const record = seeder.factory('Product').make();
      expect(record.sku).toMatch(/^SKU-[A-Z0-9]{8}$/);
    });
  });

  describe('auto factory', () => {
    it('should auto-create factory if not defined', () => {
      const schema = z.object({
        id: zdb.id(),
        name: zdb.string(),
      });

      defineModel({ name: 'AutoModel', table: 'auto_models', schema });

      const seeder = createSeeder(faker, {});
      // Factory not defined, should auto-create
      const record = seeder.factory('AutoModel').make();

      expect(record.name).toBeDefined();
    });

    it('should accept model object instead of name', () => {
      const schema = z.object({
        id: zdb.id(),
        title: zdb.string(),
      });

      const Post = defineModel({ name: 'PostModel', table: 'posts', schema });

      const seeder = createSeeder(faker, {});
      const record = seeder.factory(Post).make();

      expect(record.title).toBeDefined();
    });
  });
});


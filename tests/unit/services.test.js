const path = require('path');
const request = require('supertest');
const { z } = require('zod');
const {
  createApp,
  createServiceRegistry,
  defineService,
  ServiceRegistry,
  discoverServices,
  filePathToServiceName,
  validateServiceInput,
  executeService,
  ValidationError,
  ConfigurationError,
  NotFoundError,
  WebspressoError,
  getServiceRegistry,
  hasServiceRegistry,
} = require('../../index');

const FIXTURES_SERVICES_DIR = path.join(__dirname, '../fixtures/services');
const FIXTURES_PAGES_DIR = path.join(__dirname, '../fixtures/pages');
const FIXTURES_VIEWS_DIR = path.join(__dirname, '../fixtures/views');

describe('Webspresso Services Layer', () => {
  describe('Service Discovery & File-to-Name Mapping', () => {
    it('should map relative file paths to dot-separated service names', () => {
      expect(filePathToServiceName('user/get.js').name).toBe('user.get');
      expect(filePathToServiceName('user/profile/get.js').name).toBe('user.profile.get');
      expect(filePathToServiceName('post/publish.js').name).toBe('post.publish');
      expect(filePathToServiceName('payment/refund.js').name).toBe('payment.refund');
      expect(filePathToServiceName('report/generate.js').name).toBe('report.generate');
      expect(filePathToServiceName('health.js').name).toBe('health');
    });

    it('should handle index.js files with primary name and index alias', () => {
      const mapped = filePathToServiceName('user/index.js');
      expect(mapped.name).toBe('user');
      expect(mapped.aliases).toContain('user.index');
    });

    it('should recursively discover all valid service files in a directory', () => {
      const discovered = discoverServices(FIXTURES_SERVICES_DIR);
      const names = discovered.map(d => d.name);

      expect(names).toContain('user.get');
      expect(names).toContain('user.create');
      expect(names).toContain('user.profile.get');
      expect(names).toContain('post.publish');
      expect(names).toContain('payment.refund');
      expect(names).toContain('report.generate');
      expect(names).toContain('circular.a');
      expect(names).toContain('circular.b');
      expect(names).toContain('simple');
      expect(names).toContain('withZod');
    });

    it('should return empty array for non-existent directory', () => {
      expect(discoverServices('/non/existent/path')).toEqual([]);
    });
  });

  describe('Input Schema Validation', () => {
    it('should validate simple type descriptors (string, number, email, boolean)', () => {
      const schema = {
        id: 'number',
        name: 'string',
        email: 'email',
        active: 'boolean',
      };

      const valid = { id: 10, name: 'Alice', email: 'alice@example.com', active: true };
      expect(validateServiceInput(schema, valid, 'test.service')).toEqual(valid);

      expect(() => validateServiceInput(schema, { ...valid, id: 'not-a-number' }, 'test.service'))
        .toThrow(ValidationError);

      expect(() => validateServiceInput(schema, { ...valid, email: 'not-an-email' }, 'test.service'))
        .toThrow(ValidationError);
    });

    it('should support optional fields with question mark suffix', () => {
      const schema = {
        name: 'string',
        role: 'string?',
      };

      expect(validateServiceInput(schema, { name: 'Bob' }, 'test.service')).toEqual({ name: 'Bob' });
      expect(validateServiceInput(schema, { name: 'Bob', role: 'admin' }, 'test.service')).toEqual({ name: 'Bob', role: 'admin' });
    });

    it('should support Zod schema validation', () => {
      const schema = z.object({
        count: z.number().min(1),
        tag: z.string(),
      });

      expect(validateServiceInput(schema, { count: 5, tag: 'node' }, 'test.zod'))
        .toEqual({ count: 5, tag: 'node' });

      expect(() => validateServiceInput(schema, { count: 0, tag: 'node' }, 'test.zod'))
        .toThrow(ValidationError);
    });

    it('should support functional Zod schema syntax ({ z }) => z.object(...)', () => {
      const schemaFn = ({ z }) => z.object({
        userId: z.number().int().positive(),
        slug: z.string().min(2),
      });

      expect(validateServiceInput(schemaFn, { userId: 12, slug: 'webspresso' }, 'test.zodfn'))
        .toEqual({ userId: 12, slug: 'webspresso' });

      expect(() => validateServiceInput(schemaFn, { userId: -1, slug: 'w' }, 'test.zodfn'))
        .toThrow(ValidationError);
    });

    it('should support custom function validators', () => {
      const customValidator = (input) => {
        if (!input.token || input.token.length < 5) return false;
        return true;
      };

      expect(validateServiceInput(customValidator, { token: 'valid-token' }, 'test.custom'))
        .toEqual({ token: 'valid-token' });

      expect(() => validateServiceInput(customValidator, { token: '123' }, 'test.custom'))
        .toThrow(ValidationError);
    });

    it('should return input untouched when schema is null, undefined, or empty', () => {
      const input = { a: 1, b: 2 };
      expect(validateServiceInput(null, input, 'test.noop')).toBe(input);
      expect(validateServiceInput(undefined, input, 'test.noop')).toBe(input);
      expect(validateServiceInput({}, input, 'test.noop')).toBe(input);
    });
  });

  describe('ServiceRegistry & Programmatic Registration', () => {
    it('should create and load registry from directory', () => {
      const registry = createServiceRegistry({ servicesDir: FIXTURES_SERVICES_DIR });

      expect(registry.has('user.get')).toBe(true);
      expect(registry.has('post.publish')).toBe(true);
      expect(registry.has('payment.refund')).toBe(true);
      expect(registry.has('non.existent')).toBe(false);
      expect(registry.list()).toContain('user.get');
    });

    it('should support programmatic service registration', async () => {
      const registry = new ServiceRegistry();

      registry.register('calculator.add', {
        schema: { a: 'number', b: 'number' },
        handler: async ({ a, b }) => a + b,
      });

      registry.register('calculator.double', async ({ n }) => n * 2);

      expect(registry.has('calculator.add')).toBe(true);
      expect(registry.has('calculator.double')).toBe(true);

      const sum = await registry.call('calculator.add', { a: 15, b: 25 });
      expect(sum).toBe(40);

      const doubled = await registry.call('calculator.double', { n: 21 });
      expect(doubled).toBe(42);
    });

    it('should throw ConfigurationError when duplicate service is registered', () => {
      const registry = new ServiceRegistry();

      registry.register('duplicate.service', async () => 'first');

      expect(() => {
        registry.register('duplicate.service', async () => 'second');
      }).toThrow(ConfigurationError);
    });

    it('should helper defineService return normalized definition', () => {
      const def = defineService({
        schema: { id: 'number' },
        async handler({ id }) {
          return id * 2;
        },
      });

      expect(typeof def.handler).toBe('function');
      expect(def.schema.id).toBe('number');

      const fnDef = defineService(async (input) => input);
      expect(typeof fnDef.handler).toBe('function');
    });
  });

  describe('Service Execution, Context & Composition (Without HTTP Server)', () => {
    it('should execute service with mock context without starting HTTP server', async () => {
      const registry = createServiceRegistry({ servicesDir: FIXTURES_SERVICES_DIR });
      const mockDb = {
        users: {
          findById: async (id) => ({ id, name: 'Alice via Mock DB', email: 'alice@db.local' }),
        },
      };

      const mockCtx = { db: mockDb };
      const user = await registry.call('user.get', { id: 42 }, mockCtx);

      expect(user).toEqual({
        id: 42,
        name: 'Alice via Mock DB',
        email: 'alice@db.local',
      });
    });

    it('should support service-to-service call and preserve the exact same ctx', async () => {
      const registry = createServiceRegistry({ servicesDir: FIXTURES_SERVICES_DIR });
      const mockCtx = {
        user: { id: 7, role: 'admin' },
        session: { token: 'secret-sess-123' },
      };

      const result = await registry.call('user.profile.get', { userId: 5 }, mockCtx);

      expect(result.user).toEqual({
        id: 5,
        name: 'User 5',
        email: 'user5@example.com',
      });
      expect(result.bio).toBe('Bio for User 5');
      expect(result.theme).toBe('dark');

      // Check publish composition
      const post = await registry.call('post.publish', { title: 'Hello Webspresso', authorId: 5 }, mockCtx);
      expect(post.title).toBe('Hello Webspresso');
      expect(post.author.name).toBe('User 5');
    });

    it('should detect circular service calls and throw informative error', async () => {
      const registry = createServiceRegistry({ servicesDir: FIXTURES_SERVICES_DIR });

      await expect(registry.call('circular.a', { count: 1 })).rejects.toThrow(
        /Circular service call detected:\s*circular\.a -> circular\.b -> circular\.a/
      );
    });

    it('should throw NotFoundError when service is not found', async () => {
      const registry = createServiceRegistry({ servicesDir: FIXTURES_SERVICES_DIR });

      try {
        await registry.call('unknown.service');
        expect.unreachable('Should have thrown NotFoundError');
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundError);
        expect(err.code).toBe('SERVICE_NOT_FOUND');
        expect(err.message).toBe('Service not found: unknown.service');
      }
    });

    it('should propagate handler errors and attach service name', async () => {
      const registry = new ServiceRegistry();

      registry.register('error.failing', async () => {
        const error = new Error('Database connection timed out');
        throw error;
      });

      try {
        await registry.call('error.failing');
        expect.unreachable('Should have thrown error');
      } catch (err) {
        expect(err.message).toContain('Database connection timed out');
        expect(err.service).toBe('error.failing');
        expect(err.stack).toBeDefined();
      }
    });
  });

  describe('HTTP & SSR Integration with createApp', () => {
    it('should make req.service available in API routes and app context', async () => {
      const { app } = createApp({
        pagesDir: FIXTURES_PAGES_DIR,
        viewsDir: FIXTURES_VIEWS_DIR,
        servicesDir: FIXTURES_SERVICES_DIR,
        setupRoutes(app) {
          app.get('/test-services-api', async (req, res) => {
            const user = await req.service('user.get', { id: 100 });
            const refund = await req.service('payment.refund', {
              transactionId: 'tx_999',
              amount: 50.0,
            });

            res.json({ user, refund });
          });
        },
      });

      expect(hasServiceRegistry()).toBe(true);
      expect(getServiceRegistry()).toBeDefined();

      const res = await request(app)
        .get('/test-services-api')
        .expect(200);

      expect(res.body.user.id).toBe(100);
      expect(res.body.user.name).toBe('User 100');
      expect(res.body.refund.status).toBe('succeeded');
    });

    it('should reject invalid input via req.service with 422 ValidationError', async () => {
      const { app } = createApp({
        pagesDir: FIXTURES_PAGES_DIR,
        viewsDir: FIXTURES_VIEWS_DIR,
        servicesDir: FIXTURES_SERVICES_DIR,
        setupRoutes(app) {
          app.post('/api/test-invalid-service', async (req, res, next) => {
            try {
              const user = await req.service('user.create', req.body);
              res.json(user);
            } catch (err) {
              next(err);
            }
          });
        },
      });

      const res = await request(app)
        .post('/api/test-invalid-service')
        .send({ name: 'Bob', email: 'invalid-email' })
        .expect(422);

      expect(res.body.status).toBe(422);
      expect(res.body.error).toBe('Validation Error');
      expect(res.body.message).toContain('Invalid service input for user.create');
    });

    it('should allow SSR route load() functions to call ctx.service()', async () => {
      const { app, nunjucksEnv } = createApp({
        pagesDir: FIXTURES_PAGES_DIR,
        viewsDir: FIXTURES_VIEWS_DIR,
        servicesDir: FIXTURES_SERVICES_DIR,
        setupRoutes(app) {
          app.get('/ssr-service-test', async (req, res) => {
            const user = await req.service('user.get', { id: 77 });
            res.send(`<h1>Hello ${user.name}</h1>`);
          });
        },
      });

      const res = await request(app)
        .get('/ssr-service-test')
        .expect(200);

      expect(res.text).toContain('Hello User 77');
    });
  });
});

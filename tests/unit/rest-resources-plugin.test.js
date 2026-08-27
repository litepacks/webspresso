const z = require('zod');
const restResourcePlugin = require('../../plugins/rest-resources');
const {
  pluralizeSegment,
  parseIncludeParam,
  sanitizeRecordTree,
  pickWritableColumns,
  resolveExposedModels,
} = require('../../plugins/rest-resources');
const { defineModel, clearRegistry } = require('../../core/orm/model');

describe('REST Resources Plugin (plugins/rest-resources)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  afterAll(() => {
    clearRegistry();
  });

  describe('pluralizeSegment', () => {
    it('should pluralize English nouns properly for URL paths', () => {
      expect(pluralizeSegment('User')).toBe('users');
      expect(pluralizeSegment('Company')).toBe('companies');
      expect(pluralizeSegment('Day')).toBe('days');
      expect(pluralizeSegment('Box')).toBe('boxes');
      expect(pluralizeSegment('Match')).toBe('matches');
      expect(pluralizeSegment('Glass')).toBe('glasses');
    });
  });

  describe('parseIncludeParam', () => {
    it('should parse and filter allowed relation names', () => {
      const model = {
        relations: {
          posts: { type: 'hasMany' },
          profile: { type: 'hasOne' },
          secret: { type: 'hasOne' },
        },
        rest: {
          allowInclude: ['posts', 'profile'],
        },
      };

      expect(parseIncludeParam(model, null)).toEqual([]);
      expect(parseIncludeParam(model, '')).toEqual([]);
      expect(parseIncludeParam(model, 'posts, profile, secret, invalid')).toEqual(['posts', 'profile']);
      expect(parseIncludeParam(model, 'posts.comments')).toEqual([]); // nested not allowed
    });

    it('should allow all defined relations if allowInclude is not specified', () => {
      const model = {
        relations: {
          comments: { type: 'hasMany' },
          author: { type: 'belongsTo' },
        },
      };

      expect(parseIncludeParam(model, 'comments, author, non_existent')).toEqual(['comments', 'author']);
    });
  });

  describe('sanitizeRecordTree', () => {
    it('should strip hidden fields recursively across loaded relations', () => {
      const relatedModel = {
        hidden: ['internal_token'],
        relations: {},
      };

      const userModel = {
        hidden: ['password_hash'],
        relations: {
          profile: {
            type: 'hasOne',
            model: () => relatedModel,
          },
          posts: {
            type: 'hasMany',
            model: () => relatedModel,
          },
        },
      };

      const record = {
        id: 1,
        name: 'Alice',
        password_hash: 'secret123',
        profile: {
          bio: 'Engineer',
          internal_token: 'xyz',
        },
        posts: [
          { title: 'Hello', internal_token: 'abc' },
        ],
      };

      const clean = sanitizeRecordTree(record, userModel);
      expect(clean.password_hash).toBeUndefined();
      expect(clean.profile.internal_token).toBeUndefined();
      expect(clean.posts[0].internal_token).toBeUndefined();
      expect(clean.name).toBe('Alice');
      expect(clean.profile.bio).toBe('Engineer');
    });

    it('should handle arrays, primitives, and null gracefully', () => {
      expect(sanitizeRecordTree(null, {})).toBeNull();
      expect(sanitizeRecordTree(undefined, {})).toBeUndefined();
      expect(sanitizeRecordTree('text', {})).toBe('text');
      expect(sanitizeRecordTree(123, {})).toBe(123);
      expect(sanitizeRecordTree([{ id: 1 }], { hidden: [], relations: {} })).toEqual([{ id: 1 }]);
    });
  });

  describe('pickWritableColumns', () => {
    it('should pick only defined columns, ignoring primary autoIncrements and hidden', () => {
      const model = {
        columns: new Map([
          ['id', { primary: true, autoIncrement: true }],
          ['title', { type: 'string' }],
          ['secret', { type: 'string' }],
        ]),
        hidden: ['secret'],
      };

      const payload = {
        id: 99,
        title: 'New Article',
        secret: 'shh',
        extra_fake_column: 'ignore_me',
      };

      const writable = pickWritableColumns(payload, model);
      expect(writable).toEqual({ title: 'New Article' });
      expect(pickWritableColumns(null, model)).toEqual({});
      expect(pickWritableColumns('string', model)).toEqual({});
    });
  });

  describe('resolveExposedModels & Plugin Route Mounting', () => {
    it('should resolve models based on rest.enabled or whitelist', () => {
      const schema = z.object({ id: z.number(), name: z.string() });
      const user = defineModel({ name: 'User', table: 'users', schema, rest: { enabled: true } });
      const post = defineModel({ name: 'Post', table: 'posts', schema, rest: { enabled: false } });
      const comment = defineModel({ name: 'Comment', table: 'comments', schema, rest: { enabled: true } });

      const exposed = resolveExposedModels(null, {});
      expect(exposed.map(m => m.name).sort()).toEqual(['Comment', 'User']);

      const whitelisted = resolveExposedModels(null, { models: ['Post'] });
      expect(whitelisted.map(m => m.name)).toEqual(['Post']);

      const excluded = resolveExposedModels(null, { excludeModels: ['Comment'] });
      expect(excluded.map(m => m.name)).toEqual(['User']);

      const filtered = resolveExposedModels(null, { filter: (m) => m.name === 'Comment' });
      expect(filtered.map(m => m.name)).toEqual(['Comment']);
    });

    it('should warn and skip route mounting when ctx.db is absent', () => {
      const warnings = [];
      const origWarn = console.warn;
      console.warn = (...args) => warnings.push(args.join(' '));

      try {
        const plugin = restResourcePlugin();
        plugin.onRoutesReady({ db: null });
        expect(warnings.some(w => w.includes('Skipping routes: createApp({ db }) is required'))).toBe(true);
      } finally {
        console.warn = origWarn;
      }
    });

    it('should register CRUD routes on ctx.addRoute and honor custom rest.path', () => {
      const schema = z.object({ id: z.number(), title: z.string() });
      const article = defineModel({
        name: 'Article',
        table: 'articles',
        schema,
        rest: { enabled: true, path: 'custom-articles' },
      });

      const addedRoutes = [];
      const mockCtx = {
        db: {
          getAllModels: () => new Map([['Article', article]]),
          getRepository: () => ({}),
        },
        addRoute: (method, path, ...handlers) => {
          addedRoutes.push({ method, path, handlersCount: handlers.length });
        },
      };

      const plugin = restResourcePlugin({ path: '/api/v1' });
      plugin.onRoutesReady(mockCtx);

      expect(addedRoutes.length).toBe(5); // GET list, GET :id, POST, PATCH :id, DELETE :id
      expect(addedRoutes.some(r => r.method === 'get' && r.path === '/api/v1/custom-articles')).toBe(true);
      expect(addedRoutes.some(r => r.method === 'get' && r.path === '/api/v1/custom-articles/:id')).toBe(true);
      expect(addedRoutes.some(r => r.method === 'post' && r.path === '/api/v1/custom-articles')).toBe(true);
      expect(addedRoutes.some(r => r.method === 'patch' && r.path === '/api/v1/custom-articles/:id')).toBe(true);
      expect(addedRoutes.some(r => r.method === 'delete' && r.path === '/api/v1/custom-articles/:id')).toBe(true);
    });
  });
});


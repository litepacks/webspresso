const z = require('zod');
const {
  defineModel,
  getModel,
  getAllModels,
  hasModel,
  clearRegistry,
  unregisterModel,
  resolveRelationModel,
  getRelationKeys,
} = require('../../core/orm/model');

describe('ORM Model Definition & Registry (core/orm/model)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  afterAll(() => {
    clearRegistry();
  });

  it('should throw error when name, table, or schema is missing/invalid', () => {
    expect(() => defineModel({})).toThrow('Model name is required');
    expect(() => defineModel({ name: 'User' })).toThrow('Model table is required');
    expect(() => defineModel({ name: 'User', table: 'users' })).toThrow('Model schema is required');
    expect(() => defineModel({ name: 'User', table: 'users', schema: {} })).toThrow('must be a Zod schema');
  });

  it('should throw error on duplicate model registration', () => {
    const schema = z.object({ id: z.number() });
    defineModel({ name: 'User', table: 'users', schema });
    expect(() => defineModel({ name: 'User', table: 'users', schema })).toThrow('Model "User" is already defined');
  });

  it('should validate relation types and properties', () => {
    const schema = z.object({ id: z.number() });

    // Invalid type
    expect(() => defineModel({
      name: 'Post',
      table: 'posts',
      schema,
      relations: {
        author: { type: 'invalidType' },
      },
    })).toThrow('Invalid relation type "invalidType"');

    // Missing model function
    expect(() => defineModel({
      name: 'Post',
      table: 'posts',
      schema,
      relations: {
        author: { type: 'belongsTo', model: 'notAFunction' },
      },
    })).toThrow('must have a model function');

    // Missing foreignKey
    expect(() => defineModel({
      name: 'Post',
      table: 'posts',
      schema,
      relations: {
        author: { type: 'belongsTo', model: () => 'User' },
      },
    })).toThrow('must have a foreignKey string');
  });

  it('should register and retrieve model definition with normalized options', () => {
    const userSchema = z.object({
      id: z.number(),
      name: z.string(),
      email: z.string(),
    });

    const userModel = defineModel({
      name: 'User',
      table: 'users',
      schema: userSchema,
      admin: { enabled: true, icon: 'user' },
      rest: { enabled: true, path: '/api/v1/users', allowInclude: ['posts'] },
      hidden: ['password'],
      cache: 'auto',
    });

    expect(hasModel('User')).toBe(true);
    expect(getModel('User')).toBe(userModel);
    expect(userModel.admin.enabled).toBe(true);
    expect(userModel.rest.path).toBe('api/v1/users');
    expect(userModel.hidden).toEqual(['password']);
    expect(getAllModels().get('User')).toBe(userModel);

    // Unregister
    expect(unregisterModel('User')).toBe(true);
    expect(hasModel('User')).toBe(false);
  });

  it('should resolve relation models and relation keys correctly', () => {
    const userSchema = z.object({ id: z.number(), name: z.string() });
    const postSchema = z.object({ id: z.number(), user_id: z.number(), title: z.string() });

    defineModel({ name: 'User', table: 'users', schema: userSchema });
    const postModel = defineModel({
      name: 'Post',
      table: 'posts',
      schema: postSchema,
      relations: {
        author: {
          type: 'belongsTo',
          model: () => getModel('User'),
          foreignKey: 'user_id',
          localKey: 'id',
        },
        lazyAuthor: {
          type: 'belongsTo',
          model: () => 'User',
          foreignKey: 'user_id',
        },
      },
    });

    const relKeys = getRelationKeys(postModel, 'author');
    expect(relKeys.foreignKey).toBe('user_id');
    expect(relKeys.localKey).toBe('id');
    expect(relKeys.relatedModel.name).toBe('User');

    const lazyKeys = getRelationKeys(postModel, 'lazyAuthor');
    expect(lazyKeys.relatedModel.name).toBe('User');

    expect(() => getRelationKeys(postModel, 'nonExistent')).toThrow('Relation "nonExistent" not found');
    expect(() => resolveRelationModel({ model: () => null })).toThrow('Invalid relation model reference');
  });

  it('should warn on invalid hooks during defineModel', () => {
    const schema = z.object({ id: z.number() });
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      defineModel({
        name: 'HookTest',
        table: 'hook_tests',
        schema,
        hooks: {
          invalidHookName: () => {},
          beforeCreate: 'notAFunction',
        },
      });

      expect(warnings.some(w => w.includes('Unknown hook "invalidHookName"'))).toBe(true);
      expect(warnings.some(w => w.includes('must be a function'))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });
});

/**
 * Auth System Unit Tests
 */

const {
  hash,
  verify,
  needsRehash,
  generateToken,
  hashToken,
  PolicyManager,
  AuthorizationError,
  AuthManager,
  AuthenticationError,
  createAuth,
  quickAuth,
  createRememberTokensTable,
  dropRememberTokensTable,
} = require('../../core/auth');
const {
  definePolicy,
  defineGate,
  can,
  cannot,
  authorize,
  defaultPolicyManager,
} = require('../../core/auth/policy');

describe('Auth Hash Utilities', () => {
  describe('hash()', () => {
    it('should hash a password', async () => {
      const password = 'mySecretPassword123';
      const hashed = await hash(password);
      
      expect(hashed).toBeDefined();
      expect(hashed).not.toBe(password);
      expect(hashed.startsWith('$2')).toBe(true); // bcrypt prefix
    });

    it('should generate different hashes for same password', async () => {
      const password = 'samePassword';
      const hash1 = await hash(password);
      const hash2 = await hash(password);
      
      expect(hash1).not.toBe(hash2);
    });

    it('should throw for empty password', async () => {
      await expect(hash('')).rejects.toThrow('Password must be a non-empty string');
      await expect(hash(null)).rejects.toThrow('Password must be a non-empty string');
    });
  });

  describe('verify()', () => {
    it('should verify correct password', async () => {
      const password = 'correctPassword';
      const hashed = await hash(password);
      
      const result = await verify(password, hashed);
      expect(result).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const password = 'correctPassword';
      const hashed = await hash(password);
      
      const result = await verify('wrongPassword', hashed);
      expect(result).toBe(false);
    });

    it('should return false for empty values', async () => {
      expect(await verify('', 'somehash')).toBe(false);
      expect(await verify('password', '')).toBe(false);
      expect(await verify(null, 'somehash')).toBe(false);
    });
  });

  describe('needsRehash()', () => {
    it('should return false for hash with current rounds', async () => {
      const hashed = await hash('password', 12);
      expect(needsRehash(hashed, 12)).toBe(false);
    });

    it('should return true for hash with lower rounds', async () => {
      const hashed = await hash('password', 10);
      expect(needsRehash(hashed, 12)).toBe(true);
    });

    it('should return true for empty hash', () => {
      expect(needsRehash('')).toBe(true);
      expect(needsRehash(null)).toBe(true);
    });
  });

  describe('generateToken()', () => {
    it('should generate random token', () => {
      const token = generateToken();
      expect(token).toBeDefined();
      expect(token.length).toBe(64); // 32 bytes = 64 hex chars
    });

    it('should generate different tokens each time', () => {
      const token1 = generateToken();
      const token2 = generateToken();
      expect(token1).not.toBe(token2);
    });

    it('should respect length parameter', () => {
      const token = generateToken(16);
      expect(token.length).toBe(32); // 16 bytes = 32 hex chars
    });
  });

  describe('hashToken()', () => {
    it('should hash token with SHA-256', () => {
      const token = 'mytoken123';
      const hashed = hashToken(token);
      
      expect(hashed).toBeDefined();
      expect(hashed.length).toBe(64); // SHA-256 = 64 hex chars
    });

    it('should produce same hash for same token', () => {
      const token = 'consistentToken';
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);
      
      expect(hash1).toBe(hash2);
    });
  });
});

describe('PolicyManager', () => {
  let policies;

  beforeEach(() => {
    policies = new PolicyManager();
  });

  describe('definePolicy()', () => {
    it('should define a policy', () => {
      policies.definePolicy('post', {
        view: () => true,
        edit: (user, post) => user?.id === post?.user_id,
      });
      
      expect(policies.hasPolicy('post')).toBe(true);
    });

    it('should throw for non-object rules', () => {
      expect(() => policies.definePolicy('test', 'invalid')).toThrow();
    });

    it('should throw for non-function rule', () => {
      expect(() => policies.definePolicy('test', { view: 'notFunction' })).toThrow();
    });
  });

  describe('defineGate()', () => {
    it('should define a gate', () => {
      policies.defineGate('admin', (user) => user?.role === 'admin');
      expect(policies.hasGate('admin')).toBe(true);
    });

    it('should throw for non-function callback', () => {
      expect(() => policies.defineGate('test', 'invalid')).toThrow();
    });
  });

  describe('can()', () => {
    beforeEach(() => {
      policies.definePolicy('post', {
        view: () => true,
        edit: (user, post) => user?.id === post?.user_id,
        delete: (user) => user?.role === 'admin',
      });
      
      policies.defineGate('admin', (user) => user?.role === 'admin');
    });

    it('should check policy action', () => {
      const user = { id: 1 };
      const post = { user_id: 1 };
      
      expect(policies.can(user, 'view', 'post', post)).toBe(true);
      expect(policies.can(user, 'edit', 'post', post)).toBe(true);
    });

    it('should deny for non-owner', () => {
      const user = { id: 2 };
      const post = { user_id: 1 };
      
      expect(policies.can(user, 'edit', 'post', post)).toBe(false);
    });

    it('should check gate without policy', () => {
      const admin = { role: 'admin' };
      const user = { role: 'user' };
      
      expect(policies.can(admin, 'admin')).toBe(true);
      expect(policies.can(user, 'admin')).toBe(false);
    });

    it('should return false for undefined policy', () => {
      expect(policies.can({}, 'view', 'nonexistent')).toBe(false);
    });

    it('should return false for undefined action', () => {
      expect(policies.can({}, 'nonexistent', 'post')).toBe(false);
    });

    it('should return false when gate throws', () => {
      policies.defineGate('broken', () => {
        throw new Error('gate fail');
      });
      expect(policies.can({}, 'broken')).toBe(false);
    });

    it('should return false when policy rule throws', () => {
      policies.definePolicy('fragile', {
        view: () => {
          throw new Error('rule fail');
        },
      });
      expect(policies.can({}, 'view', 'fragile')).toBe(false);
    });

    it('getPolicies and getGates list names', () => {
      policies.definePolicy('post', { view: () => true });
      policies.defineGate('admin', () => true);
      expect(policies.getPolicies()).toContain('post');
      expect(policies.getGates()).toContain('admin');
    });
  });

  describe('cannot()', () => {
    it('should be inverse of can', () => {
      policies.definePolicy('post', {
        view: () => true,
      });
      
      expect(policies.cannot({}, 'view', 'post')).toBe(false);
      expect(policies.cannot({}, 'edit', 'post')).toBe(true);
    });
  });

  describe('authorize()', () => {
    beforeEach(() => {
      policies.definePolicy('post', {
        view: () => true,
        edit: () => false,
      });
    });

    it('should not throw for authorized action', () => {
      expect(() => policies.authorize({}, 'view', 'post')).not.toThrow();
    });

    it('should throw AuthorizationError for unauthorized action', () => {
      expect(() => policies.authorize({}, 'edit', 'post')).toThrow(AuthorizationError);
    });

    it('should include action and policy in error', () => {
      try {
        policies.authorize({}, 'edit', 'post');
      } catch (error) {
        expect(error.action).toBe('edit');
        expect(error.policy).toBe('post');
        expect(error.status).toBe(403);
      }
    });
  });

  describe('before()', () => {
    it('should run before callback', () => {
      policies.definePolicy('post', {
        edit: () => false,
      });
      
      // Admin can do anything
      policies.before((user) => {
        if (user?.role === 'admin') return true;
        return null; // Continue normal check
      });
      
      const admin = { role: 'admin' };
      const user = { role: 'user' };
      
      expect(policies.can(admin, 'edit', 'post')).toBe(true);
      expect(policies.can(user, 'edit', 'post')).toBe(false);
    });
  });

  describe('clear()', () => {
    it('should clear all policies and gates', () => {
      policies.definePolicy('post', { view: () => true });
      policies.defineGate('admin', () => true);
      policies.before(() => true);
      
      policies.clear();
      
      expect(policies.hasPolicy('post')).toBe(false);
      expect(policies.hasGate('admin')).toBe(false);
    });
  });
});

describe('AuthManager', () => {
  const mockFindUserById = vi.fn();
  const mockFindUserByCredentials = vi.fn();
  
  beforeEach(() => {
    mockFindUserById.mockReset();
    mockFindUserByCredentials.mockReset();
  });

  describe('constructor', () => {
    it('should create instance with valid config', () => {
      const auth = new AuthManager({
        findUserById: mockFindUserById,
        findUserByCredentials: mockFindUserByCredentials,
        session: { secret: 'test-secret' },
      });
      
      expect(auth).toBeInstanceOf(AuthManager);
    });

    it('should throw for missing findUserById', () => {
      expect(() => new AuthManager({
        findUserByCredentials: mockFindUserByCredentials,
      })).toThrow('findUserById function is required');
    });

    it('should throw for missing findUserByCredentials', () => {
      expect(() => new AuthManager({
        findUserById: mockFindUserById,
      })).toThrow('findUserByCredentials function is required');
    });

    it('should validate rememberTokens adapter', () => {
      expect(() => new AuthManager({
        findUserById: mockFindUserById,
        findUserByCredentials: mockFindUserByCredentials,
        rememberTokens: {
          create: () => {},
          // Missing other methods
        },
      })).toThrow('rememberTokens.find function is required');
    });
  });

  describe('getSessionConfig()', () => {
    it('should return session config', () => {
      const auth = new AuthManager({
        findUserById: mockFindUserById,
        findUserByCredentials: mockFindUserByCredentials,
        session: { secret: 'my-secret', name: 'custom.sid' },
      });
      
      const config = auth.getSessionConfig();
      
      expect(config.secret).toBe('my-secret');
      expect(config.name).toBe('custom.sid');
    });

    it('should throw if secret is missing', () => {
      const auth = new AuthManager({
        findUserById: mockFindUserById,
        findUserByCredentials: mockFindUserByCredentials,
        session: { name: 'test' },
      });
      
      expect(() => auth.getSessionConfig()).toThrow('Session secret is required');
    });
  });

  describe('definePolicy()', () => {
    it('should define policy on internal PolicyManager', () => {
      const auth = new AuthManager({
        findUserById: mockFindUserById,
        findUserByCredentials: mockFindUserByCredentials,
        session: { secret: 'test' },
      });
      
      auth.definePolicy('post', {
        view: () => true,
      });
      
      expect(auth.policies.hasPolicy('post')).toBe(true);
    });
  });

  describe('defineGate()', () => {
    it('should define gate on internal PolicyManager', () => {
      const auth = new AuthManager({
        findUserById: mockFindUserById,
        findUserByCredentials: mockFindUserByCredentials,
        session: { secret: 'test' },
      });
      
      auth.defineGate('admin', (user) => user?.role === 'admin');
      
      expect(auth.policies.hasGate('admin')).toBe(true);
    });
  });
});

describe('AuthenticationError', () => {
  it('should create error with default message', () => {
    const error = new AuthenticationError();
    
    expect(error.message).toBe('Authentication failed');
    expect(error.code).toBe('AUTH_FAILED');
    expect(error.status).toBe(401);
  });

  it('should create error with custom message and code', () => {
    const error = new AuthenticationError('Invalid token', 'INVALID_TOKEN');
    
    expect(error.message).toBe('Invalid token');
    expect(error.code).toBe('INVALID_TOKEN');
  });
});

describe('createAuth / quickAuth', () => {
  it('createAuth returns AuthManager instance', () => {
    const auth = createAuth({
      findUserById: async () => null,
      findUserByCredentials: async () => null,
      session: { secret: 'test-secret-key-32chars-min' },
    });
    expect(auth).toBeInstanceOf(AuthManager);
  });

  it('quickAuth wires repository lookups', async () => {
    const users = new Map([[1, { id: 1, email: 'a@b.com', password: await hash('pass') }]]);
    const db = {
      getRepository: () => ({
        findById: async (id) => users.get(id) || null,
        findOne: async (q) => {
          for (const u of users.values()) {
            if (u.email === q.email) return u;
          }
          return null;
        },
      }),
      knex: vi.fn(() => ({
        insert: vi.fn().mockResolvedValue(undefined),
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(undefined),
      })),
    };

    const auth = quickAuth({
      db,
      session: { secret: 'test-secret-key-32chars-min' },
      rememberMe: false,
    });

    const user = await auth.findUserByCredentials('a@b.com', 'pass');
    expect(user?.id).toBe(1);
  });

  it('quickAuth throws without db.getRepository', () => {
    expect(() => quickAuth({})).toThrow('db with getRepository is required');
  });
});

describe('remember_tokens migrations', () => {
  it('createRememberTokensTable creates table when missing', async () => {
    const knex = {
      schema: {
        hasTable: vi.fn().mockResolvedValue(false),
        createTable: vi.fn((name, cb) => {
          const table = {
            bigIncrements: vi.fn().mockReturnThis(),
            primary: vi.fn().mockReturnThis(),
            bigInteger: vi.fn().mockReturnThis(),
            unsigned: vi.fn().mockReturnThis(),
            notNullable: vi.fn().mockReturnThis(),
            string: vi.fn().mockReturnThis(),
            unique: vi.fn().mockReturnThis(),
            timestamp: vi.fn().mockReturnThis(),
            defaultTo: vi.fn().mockReturnThis(),
            index: vi.fn().mockReturnThis(),
          };
          cb(table);
        }),
      },
      fn: { now: vi.fn() },
    };
    await createRememberTokensTable(knex);
    expect(knex.schema.createTable).toHaveBeenCalledWith('remember_tokens', expect.any(Function));
  });

  it('dropRememberTokensTable drops table', async () => {
    const knex = { schema: { dropTableIfExists: vi.fn().mockResolvedValue(undefined) } };
    await dropRememberTokensTable(knex);
    expect(knex.schema.dropTableIfExists).toHaveBeenCalledWith('remember_tokens');
  });
});

describe('policy module exports', () => {
  beforeEach(() => {
    defaultPolicyManager.clear();
  });

  it('definePolicy / can / cannot / authorize on default instance', () => {
    definePolicy('article', { view: () => true, edit: () => false });
    expect(can({}, 'view', 'article')).toBe(true);
    expect(cannot({}, 'edit', 'article')).toBe(true);
    expect(() => authorize({}, 'edit', 'article')).toThrow(AuthorizationError);
  });

  it('defineGate works on default instance', () => {
    defineGate('staff', (user) => user?.staff === true);
    expect(can({ staff: true }, 'staff')).toBe(true);
    expect(can({}, 'staff')).toBe(false);
  });
});

describe('AuthManager request auth', () => {
  const mockFindUserById = vi.fn();
  const mockFindUserByCredentials = vi.fn();

  function mockReqRes() {
    const session = { userId: null, regenerate: (cb) => cb(null), destroy: (cb) => cb(null) };
    const req = {
      session,
      cookies: {},
      signedCookies: {},
      user: null,
    };
    const res = {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    };
    return { req, res };
  }

  beforeEach(() => {
    mockFindUserById.mockReset();
    mockFindUserByCredentials.mockReset();
  });

  it('createRequestAuth attempt/login/logout/check', async () => {
    const auth = new AuthManager({
      findUserById: mockFindUserById,
      findUserByCredentials: mockFindUserByCredentials,
      session: { secret: 'test-secret-key-32chars-min' },
    });
    const { req, res } = mockReqRes();
    const reqAuth = auth.createRequestAuth(req, res);

    mockFindUserByCredentials.mockResolvedValue({ id: 7, email: 'u@test.com' });
    const user = await reqAuth.attempt('u@test.com', 'pass');
    expect(user.id).toBe(7);
    expect(reqAuth.check()).toBe(true);

    await reqAuth.logout();
    expect(reqAuth.guest()).toBe(true);
    expect(reqAuth.user()).toBeNull();
  });

  it('verifyRememberToken returns null without cookie', async () => {
    const rememberTokens = {
      create: vi.fn(),
      find: vi.fn(),
      delete: vi.fn(),
      deleteAllForUser: vi.fn(),
    };
    const auth = new AuthManager({
      findUserById: mockFindUserById,
      findUserByCredentials: mockFindUserByCredentials,
      session: { secret: 'test-secret-key-32chars-min' },
      rememberTokens,
    });
    const { req, res } = mockReqRes();
    const user = await auth.verifyRememberToken(req, res);
    expect(user).toBeNull();
  });
});

describe('AuthorizationError', () => {
  it('should create error with default message', () => {
    const error = new AuthorizationError();
    
    expect(error.message).toBe('This action is unauthorized');
    expect(error.status).toBe(403);
  });

  it('should create error with action and policy', () => {
    const error = new AuthorizationError('Cannot edit', 'edit', 'post');
    
    expect(error.message).toBe('Cannot edit');
    expect(error.action).toBe('edit');
    expect(error.policy).toBe('post');
  });
});

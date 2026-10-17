/**
 * Unit tests for Auth Cryptography, Tokens, and Zero-Dependency JWT
 * @vitest-environment node
 */

import { describe, it, expect, vi } from 'vitest';

const {
  hash,
  verify,
  needsRehash,
  generateToken,
  hashToken,
  DEFAULT_ROUNDS,
} = require('../../../core/auth/hash');

const {
  signJwt,
  verifyJwt,
  decodeJwt,
  base64UrlEncode,
  base64UrlDecode,
  parseDuration,
} = require('../../../core/auth/jwt');

const {
  TOKEN_TYPES,
  createAuthTokensTable,
  dropAuthTokensTable,
  createKnexAuthTokensAdapter,
  createAuthToken,
  verifyAuthToken,
  consumeAuthToken,
  purgeExpiredAuthTokens,
} = require('../../../core/auth/tokens');

describe('Auth Cryptography & Password Hashing (core/auth/hash)', () => {
  it('hashes and verifies plain passwords accurately using bcrypt', async () => {
    const rawPass = 'SuperSecretP@ssword123';
    const hashed = await hash(rawPass, 4);

    expect(typeof hashed).toBe('string');
    expect(hashed).toMatch(/^\$2[aby]\$/);

    const matches = await verify(rawPass, hashed);
    expect(matches).toBe(true);

    const wrongMatches = await verify('WrongPassword', hashed);
    expect(wrongMatches).toBe(false);
  });

  it('handles invalid inputs gracefully in hash and verify', async () => {
    await expect(hash('')).rejects.toThrow('Password must be a non-empty string');
    await expect(hash(null)).rejects.toThrow('Password must be a non-empty string');

    expect(await verify('', '$2a$04$test')).toBe(false);
    expect(await verify('pass', null)).toBe(false);
    expect(await verify('pass', 'invalid-bcrypt-string')).toBe(false);
  });

  it('checks needsRehash with desired cost factor and default rounds', async () => {
    const hashedDefault = await hash('password');
    expect(needsRehash(hashedDefault)).toBe(false);
    expect(needsRehash(hashedDefault, 10)).toBe(true);
    expect(needsRehash(null)).toBe(true);
    expect(needsRehash('not-a-hash')).toBe(true);
  });

  it('generates random hex tokens and calculates SHA-256 token hashes', () => {
    const token = generateToken(16);
    expect(token).toHaveLength(32); // 16 bytes = 32 hex chars

    const hash1 = hashToken(token);
    const hash2 = hashToken(token);
    expect(hash1).toHaveLength(64); // SHA-256 = 64 hex chars
    expect(hash1).toBe(hash2);
  });
});

describe('Zero-Dependency JWT Subsystem (core/auth/jwt)', () => {
  const SECRET = 'jwt-super-secret-key-32-bytes-long!';

  describe('base64Url & parseDuration', () => {
    it('encodes and decodes base64url strings', () => {
      const original = 'Hello World?! /+==';
      const encoded = base64UrlEncode(original);
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');

      const decoded = base64UrlDecode(encoded);
      expect(decoded).toBe(original);
    });

    it('parses duration strings into seconds correctly', () => {
      expect(parseDuration(120)).toBe(120);
      expect(parseDuration('30s')).toBe(30);
      expect(parseDuration('15m')).toBe(900);
      expect(parseDuration('2h')).toBe(7200);
      expect(parseDuration('7d')).toBe(604800);
      expect(parseDuration('500')).toBe(500);
      expect(parseDuration(null)).toBe(3600);
    });
  });

  describe('signJwt, verifyJwt & decodeJwt', () => {
    it('signs and verifies a valid JWT payload', () => {
      const payload = { userId: 42, role: 'admin' };
      const token = signJwt(payload, SECRET, { expiresIn: '1h', issuer: 'webspresso' });

      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);

      const verified = verifyJwt(token, SECRET, { issuer: 'webspresso' });
      expect(verified.userId).toBe(42);
      expect(verified.role).toBe('admin');
      expect(verified.iss).toBe('webspresso');
      expect(verified.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('throws error when secret is missing or algorithm is unsupported', () => {
      expect(() => signJwt({ id: 1 }, '')).toThrow('Secret is required to sign JWT');
      expect(() => signJwt({ id: 1 }, SECRET, { algorithm: 'RS256' })).toThrow(/Unsupported algorithm/);
    });

    it('rejects expired tokens unless ignoreExpiration is true', () => {
      const expiredToken = signJwt({ id: 1 }, SECRET, { expiresIn: -10 }); // Expired in past

      expect(() => verifyJwt(expiredToken, SECRET)).toThrow('JWT token has expired');

      const decodedAnyway = verifyJwt(expiredToken, SECRET, { ignoreExpiration: true });
      expect(decodedAnyway.id).toBe(1);
    });

    it('rejects tampered signature or invalid secret', () => {
      const token = signJwt({ user: 'alice' }, SECRET);
      expect(() => verifyJwt(token, 'wrong-secret')).toThrow('Invalid JWT signature');

      const parts = token.split('.');
      const tamperedPayload = base64UrlEncode(JSON.stringify({ user: 'eve' }));
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      expect(() => verifyJwt(tamperedToken, SECRET)).toThrow('Invalid JWT signature');
    });

    it('validates issuer and audience options', () => {
      const token = signJwt({ id: 1 }, SECRET, { issuer: 'app', audience: 'mobile' });

      expect(() => verifyJwt(token, SECRET, { issuer: 'different' })).toThrow(/Invalid JWT issuer/);
      expect(() => verifyJwt(token, SECRET, { audience: 'web' })).toThrow(/Invalid JWT audience/);
    });

    it('decodes JWT without signature verification', () => {
      const token = signJwt({ name: 'Bob' }, SECRET);
      const decoded = decodeJwt(token);

      expect(decoded.header.alg).toBe('HS256');
      expect(decoded.payload.name).toBe('Bob');

      expect(decodeJwt('not.a.jwt')).toBeNull();
      expect(decodeJwt(null)).toBeNull();
    });
  });
});

describe('Auth Tokens & Storage Adapter (core/auth/tokens)', () => {
  it('exports TOKEN_TYPES enum', () => {
    expect(TOKEN_TYPES.PASSWORD_RESET).toBe('password_reset');
    expect(TOKEN_TYPES.EMAIL_VERIFY).toBe('email_verify');
    expect(TOKEN_TYPES.MAGIC_LINK).toBe('magic_link');
  });

  it('manages auth token lifecycle with mock adapter', async () => {
    const memoryStore = new Map();

    const mockAdapter = {
      create: vi.fn(async (userId, tokenHash, type, expiresAt) => {
        memoryStore.set(`${tokenHash}:${type}`, { user_id: userId, token: tokenHash, type, expires_at: expiresAt });
      }),
      find: vi.fn(async (tokenHash, type) => {
        return memoryStore.get(`${tokenHash}:${type}`) || null;
      }),
      delete: vi.fn(async (tokenHash) => {
        for (const [key, val] of memoryStore.entries()) {
          if (val.token === tokenHash) memoryStore.delete(key);
        }
      }),
      deleteAllForUser: vi.fn(async (userId, type) => {
        for (const [key, val] of memoryStore.entries()) {
          if (val.user_id === userId && (!type || val.type === type)) {
            memoryStore.delete(key);
          }
        }
      }),
      purgeExpired: vi.fn(async () => {
        let count = 0;
        const now = new Date();
        for (const [key, val] of memoryStore.entries()) {
          if (val.expires_at < now) {
            memoryStore.delete(key);
            count++;
          }
        }
        return count;
      }),
    };

    // 1. Create Token
    const { rawToken, expiresAt } = await createAuthToken(
      mockAdapter,
      TOKEN_TYPES.PASSWORD_RESET,
      100,
      3600000
    );
    expect(typeof rawToken).toBe('string');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(mockAdapter.create).toHaveBeenCalled();

    // 2. Verify Valid Token
    const verified = await verifyAuthToken(mockAdapter, TOKEN_TYPES.PASSWORD_RESET, rawToken);
    expect(verified).not.toBeNull();
    expect(verified.userId).toBe(100);

    // 3. Verify Non-Existent or Invalid Token
    const invalid = await verifyAuthToken(mockAdapter, TOKEN_TYPES.PASSWORD_RESET, 'wrong-token');
    expect(invalid).toBeNull();
    expect(await verifyAuthToken(mockAdapter, TOKEN_TYPES.PASSWORD_RESET, null)).toBeNull();

    // 4. Consume Token
    await consumeAuthToken(mockAdapter, verified.tokenHash);
    expect(mockAdapter.delete).toHaveBeenCalledWith(verified.tokenHash);

    // 5. Purge Expired Tokens
    const purged = await purgeExpiredAuthTokens(mockAdapter);
    expect(mockAdapter.purgeExpired).toHaveBeenCalled();

    // 6. Verify Expired Token
    const expiredRecord = {
      user_id: 200,
      token: 'expired-hash',
      expires_at: new Date(Date.now() - 10000),
    };
    mockAdapter.find.mockResolvedValueOnce(expiredRecord);
    const expiredResult = await verifyAuthToken(mockAdapter, TOKEN_TYPES.PASSWORD_RESET, 'raw-expired');
    expect(expiredResult).toBeNull();
    expect(mockAdapter.delete).toHaveBeenCalledWith(hashToken('raw-expired'));
  });

  it('handles purgeExpiredAuthTokens with null or invalid adapter gracefully', async () => {
    expect(await purgeExpiredAuthTokens(null)).toBe(0);
    expect(await purgeExpiredAuthTokens({})).toBe(0);
  });

  it('interacts with Knex schema and query builder in KnexAuthTokensAdapter', async () => {
    const tableTracker = { exists: false, tables: {} };
    const queryCalls = [];

    const mockKnex = Object.assign(
      (tableName) => ({
        where: (condition) => {
          queryCalls.push({ type: 'where', table: tableName, condition });
          return {
            first: async () => ({ user_id: 1, token: 'mock-hash', type: 'password_reset', expires_at: new Date() }),
            delete: async () => 1,
            where: () => ({ delete: async () => 1 }),
          };
        },
        insert: async (data) => {
          queryCalls.push({ type: 'insert', table: tableName, data });
        },
      }),
      {
        schema: {
          hasTable: vi.fn(async (t) => {
            const has = tableTracker.exists;
            tableTracker.exists = true; // next check will be true
            return has;
          }),
          createTable: vi.fn(async (t, callback) => {
            const mockTable = {
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
            callback(mockTable);
          }),
          dropTableIfExists: vi.fn(async (t) => {}),
        },
        fn: {
          now: () => 'CURRENT_TIMESTAMP',
        },
      }
    );

    // 1. createAuthTokensTable
    await createAuthTokensTable(mockKnex);
    expect(mockKnex.schema.createTable).toHaveBeenCalledTimes(1);

    // Running again when table exists should return early
    await createAuthTokensTable(mockKnex);
    expect(mockKnex.schema.createTable).toHaveBeenCalledTimes(1);

    // 2. dropAuthTokensTable
    await dropAuthTokensTable(mockKnex);
    expect(mockKnex.schema.dropTableIfExists).toHaveBeenCalledWith('auth_tokens');

    // 3. createKnexAuthTokensAdapter CRUD
    const adapter = createKnexAuthTokensAdapter({ knex: mockKnex });
    await adapter.create(10, 'hash123', TOKEN_TYPES.PASSWORD_RESET, new Date());
    expect(queryCalls.some((c) => c.type === 'insert')).toBe(true);

    const found = await adapter.find('hash123', TOKEN_TYPES.PASSWORD_RESET);
    expect(found).not.toBeNull();

    await adapter.delete('hash123');
    await adapter.deleteAllForUser(10, TOKEN_TYPES.PASSWORD_RESET);
    await adapter.deleteAllForUser(10);
    await adapter.purgeExpired();
  });

  it('validates JWT claims and throws on issuer or audience mismatch', () => {
    const secret = 'claim-secret-12345678901234567890';
    const token = signJwt(
      { userId: 5 },
      secret,
      {
        issuer: 'https://auth.mycorp.com',
        audience: 'https://api.mycorp.com',
        expiresIn: false, // test expiresIn === false branch
      }
    );

    const decoded = verifyJwt(token, secret, {
      issuer: 'https://auth.mycorp.com',
      audience: 'https://api.mycorp.com',
    });
    expect(decoded.userId).toBe(5);
    expect(decoded.exp).toBeUndefined(); // no expiration claim

    expect(() =>
      verifyJwt(token, secret, { issuer: 'https://wrong-issuer.com' })
    ).toThrow(/Invalid JWT issuer/);

    expect(() =>
      verifyJwt(token, secret, { audience: 'https://wrong-audience.com' })
    ).toThrow(/Invalid JWT audience/);
  });

  it('handles invalid JWT header and payload formatting', () => {
    const secret = 'some-secret-12345678901234567890';

    // Malformed JSON header
    const badHeader = `${base64UrlEncode('not-json')}.${base64UrlEncode('{}')}.sig`;
    expect(() => verifyJwt(badHeader, secret)).toThrow('Invalid JWT header JSON');

    // Malformed JSON payload
    const badPayload = `${base64UrlEncode('{"alg":"HS256"}')}.${base64UrlEncode('{bad json')}.sig`;
    expect(() => verifyJwt(badPayload, secret)).toThrow('Invalid JWT payload JSON');

    // Unsupported algorithm
    const wrongAlg = `${base64UrlEncode('{"alg":"RS256"}')}.${base64UrlEncode('{}')}.sig`;
    expect(() => verifyJwt(wrongAlg, secret)).toThrow(/Unsupported algorithm 'RS256'/);

    // decodeJwt on invalid format
    expect(decodeJwt('not.a.three.part.jwt.token')).toBeNull();
    expect(decodeJwt(null)).toBeNull();
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  createAuth,
  hash,
  verify,
  needsRehash,
  signJwt,
  verifyJwt,
  clearJwtCache,
  MAX_PAYLOAD_SIZE,
  generateToken,
  hashToken,
  generateTotpSecret,
  generateTotp,
  verifyTotp,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyRecoveryCode,
  createMemorySessionTracker,
  createRedisSessionTracker,
  InMemoryRedisClient,
  createRedisSessionStore,
  PolicyManager,
} = require('../../core/auth');

describe('Auth Architecture Stress Lab', () => {
  beforeEach(() => {
    clearJwtCache();
  });

  it('1. handles 500 concurrent JWT sign/verify ops with cross-secret isolation, alg=none rejection, and size limits', async () => {
    const secretA = 'super-secret-alpha-key-32-chars-min!!';
    const secretB = 'super-secret-bravo-key-32-chars-min!!';

    const tokens = await Promise.all(
      Array.from({ length: 250 }, (_, i) =>
        Promise.resolve(
          signJwt({ id: i + 1, role: i % 2 === 0 ? 'admin' : 'user', type: 'access' }, secretA, {
            expiresIn: '1h',
            issuer: 'webspresso',
            audience: 'api',
          })
        )
      )
    );

    // Parallel verify with right secret succeeds
    const verified = await Promise.all(
      tokens.map((tok) =>
        Promise.resolve(verifyJwt(tok, secretA, { issuer: 'webspresso', audience: 'api' }))
      )
    );
    expect(verified.length).toBe(250);
    expect(verified[0].id).toBe(1);
    expect(verified[249].id).toBe(250);

    // Cross-secret verification must fail for every token
    for (let i = 0; i < 20; i++) {
      expect(() => verifyJwt(tokens[i], secretB)).toThrow();
    }

    // Tampered payload & alg=none attack must fail
    const parts = tokens[0].split('.');
    const algNoneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expect(() => verifyJwt(`${algNoneHeader}.${parts[1]}.`, secretA)).toThrow();
    expect(() => verifyJwt(`${parts[0]}.${parts[1]}.tampered`, secretA)).toThrow();

    // Oversized token guard in verifyJwt (MAX_PAYLOAD_SIZE)
    const oversized = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${'a'.repeat(MAX_PAYLOAD_SIZE + 512)}.sig`;
    expect(() => verifyJwt(oversized, secretA)).toThrow();
  });

  it('2. handles 30 concurrent createRequestAuth().attempt() logins (valid + invalid) with session isolation', async () => {
    const users = new Map([
      ['alice@example.com', { id: 1, email: 'alice@example.com', password: 'pw', role: 'user' }],
      ['bob@example.com', { id: 2, email: 'bob@example.com', password: 'pw', role: 'user' }],
    ]);

    const auth = createAuth({
      findUserById: async (id) => Array.from(users.values()).find((u) => u.id === id) || null,
      findUserByCredentials: async (email, password) => {
        const u = users.get(email);
        if (!u || password !== u.password) return null;
        return u;
      },
      session: { secret: 'session-secret-key-for-stress-test-123' },
      jwt: { secret: 'jwt-secret-key-for-stress-test-12345' },
    });

    const makeReq = () => ({ session: {}, headers: {}, ip: '10.0.0.1' });
    const makeRes = () => ({ cookie() {}, clearCookie() {} });

    // 20 concurrent failed attempts for Alice
    const failedResults = await Promise.all(
      Array.from({ length: 20 }, () =>
        auth.createRequestAuth(makeReq(), makeRes()).attempt('alice@example.com', 'wrong')
      )
    );
    expect(failedResults.every((r) => r === null)).toBe(true);

    // 10 concurrent valid logins for Alice & Bob stay isolated per request session
    const validReqs = Array.from({ length: 10 }, () => makeReq());
    const validResults = await Promise.all(
      validReqs.map((req, i) =>
        auth
          .createRequestAuth(req, makeRes())
          .attempt(i % 2 === 0 ? 'alice@example.com' : 'bob@example.com', 'pw')
      )
    );
    expect(validResults[0].email).toBe('alice@example.com');
    expect(validResults[1].email).toBe('bob@example.com');
  });

  it('3. rotates JWT access/refresh tokens and rejects access-as-refresh & refresh-as-access misuse', async () => {
    const user = { id: 42, email: 'rot@example.com', role: 'editor' };
    const auth = createAuth({
      findUserById: async (id) => (id === 42 ? user : null),
      findUserByCredentials: async () => null,
      session: { secret: 'session-secret-key-for-stress-test-123' },
      jwt: {
        secret: 'access-secret-key-32-chars-minimum!!',
        refreshSecret: 'refresh-secret-key-32-chars-minimum!',
        expiresIn: '15m',
        refreshExpiresIn: '7d',
      },
    });

    const access1 = auth.generateUserToken(user);
    const refresh1 = auth.generateRefreshToken(user);

    // Refresh token cannot be used as access token
    expect(() => auth.verifyJwt(refresh1)).toThrow();
    // Access token cannot be used in refreshAccessToken
    await expect(auth.refreshAccessToken(access1)).rejects.toThrow();

    // Concurrent refresh bursts produce unique rotated tokens (unique jti)
    const rotated = await Promise.all(
      Array.from({ length: 15 }, () => auth.refreshAccessToken(refresh1, { rotate: true }))
    );
    const refreshSet = new Set(rotated.map((r) => r.refreshToken));
    expect(refreshSet.size).toBe(15);
    for (const r of rotated) {
      expect(auth.verifyJwt(r.accessToken).id).toBe(42);
    }
  });

  it('4. stress-tests distributed Redis session store & tracker across 50 concurrent sessions and revokeAllExcept', async () => {
    const redis = new InMemoryRedisClient();
    const store = createRedisSessionStore({ client: redis, prefix: 'sess:', ttl: 3600 });
    const tracker = createRedisSessionTracker({ client: redis, prefix: 'sess_idx:', ttl: 3600 });
    const memTracker = createMemorySessionTracker();

    // Create 50 concurrent sessions for user 7
    await Promise.all(
      Array.from({ length: 50 }, async (_, i) => {
        const sid = `sid-${i}`;
        await new Promise((resolve, reject) => {
          store.set(sid, { userId: 7, device: `dev-${i}` }, (err) => (err ? reject(err) : resolve()));
        });
        await tracker.track(sid, 7, {
          ip: `192.168.1.${i % 250}`,
          userAgent: 'Mozilla/5.0',
        });
        await memTracker.track(sid, 7, {
          ip: `192.168.1.${i % 250}`,
          userAgent: 'Mozilla/5.0',
        });
      })
    );

    const activeRedis = await tracker.list(7);
    const activeMem = await memTracker.list(7);
    expect(activeRedis.length).toBe(50);
    expect(activeMem.length).toBe(50);

    // Revoke all except sid-0
    await tracker.revokeOthers(7, 'sid-0');
    await memTracker.revokeOthers(7, 'sid-0');

    const afterRedis = await tracker.list(7, 'sid-0');
    const afterMem = await memTracker.list(7, 'sid-0');
    expect(afterRedis.map((s) => s.session_id || s.sessionId || s.id)).toEqual(['sid-0']);
    expect(afterMem.map((s) => s.session_id || s.sessionId || s.id)).toEqual(['sid-0']);
  });

  it('5. stress-tests TOTP 2FA window verification, recovery code hashing, and scrypt password concurrency', async () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = generateTotp(secret, { timestamp: now });
    expect(verifyTotp(code, secret, { timestamp: now, window: 1 })).toBe(true);
    expect(verifyTotp('000000', secret, { timestamp: now, window: 0 })).toBe(false);

    // Recovery codes: generate 10, hash, verify single-use consumption without false positives
    const codes = generateRecoveryCodes({ count: 10 });
    expect(codes.length).toBe(10);
    let remaining = codes.map((c) => hashRecoveryCode(c));
    for (let i = 0; i < codes.length; i++) {
      const invalidRes = verifyRecoveryCode('INVALID-CODE', remaining);
      expect(invalidRes.valid).toBe(false);
      const okRes = verifyRecoveryCode(codes[i], remaining);
      expect(okRes.valid).toBe(true);
      remaining = okRes.remainingHashedCodes;
    }
    expect(remaining.length).toBe(0);
    // Replaying an already-consumed recovery code must fail
    expect(verifyRecoveryCode(codes[0], remaining).valid).toBe(false);

    // Concurrent scrypt password hashing & verification
    const pwHashes = await Promise.all(
      Array.from({ length: 12 }, (_, i) => hash(`Password!#${i}`, { algorithm: 'scrypt', cost: 1024 }))
    );
    const checks = await Promise.all(
      pwHashes.map((h, i) => verify(`Password!#${i}`, h))
    );
    expect(checks.every(Boolean)).toBe(true);
    expect(await verify('WrongPassword', pwHashes[0])).toBe(false);
    expect(needsRehash(pwHashes[0], { algorithm: 'scrypt', cost: 16384 })).toBe(true);

    // Constant-time token generation uniqueness across 200 tokens
    const rawTokens = Array.from({ length: 200 }, () => generateToken(24));
    const hashedSet = new Set(rawTokens.map((t) => hashToken(t)));
    expect(hashedSet.size).toBe(200);
  });

  it('6. evaluates 50 PolicyManager RBAC gates & policies with isolation', () => {
    const policies = new PolicyManager();
    for (let i = 0; i < 50; i++) {
      policies.defineGate(`resource.${i}.edit`, (user, doc) => {
        if (!user) return false;
        if (user.role === 'admin') return true;
        return Boolean(doc && doc.ownerId === user.id && i % 2 === 0);
      });
    }

    const admin = { id: 1, role: 'admin' };
    const owner = { id: 2, role: 'user' };
    const stranger = { id: 3, role: 'user' };

    const results = Array.from({ length: 50 }, (_, i) => ({
      adminOk: policies.can(admin, `resource.${i}.edit`, null, { ownerId: 99 }),
      ownerOk: policies.can(owner, `resource.${i}.edit`, null, { ownerId: 2 }),
      strangerOk: policies.can(stranger, `resource.${i}.edit`, null, { ownerId: 2 }),
    }));

    expect(results.every((r) => r.adminOk === true)).toBe(true);
    expect(results.every((r) => r.strangerOk === false)).toBe(true);
    expect(results[0].ownerOk).toBe(true);
    expect(results[1].ownerOk).toBe(false);
  });
});

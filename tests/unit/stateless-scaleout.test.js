/**
 * Unit Tests for Stateless Scale-Out & Distributed Session Management
 * Tests RedisSessionStore, RedisSessionTracker, MiniRedisClient, InMemoryRedisClient,
 * and Serverless Database Connection Pool Optimizer.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createRedisSessionStore,
  createRedisSessionTracker,
  RedisSessionStore,
  InMemoryRedisClient,
  MiniRedisClient,
  createMiniRedisClient,
} from '../../core/auth/redis-session';
import {
  isServerlessEnvironment,
  normalizeServerlessPoolConfig,
} from '../../core/orm/pool';
import { runDeployCheck } from '../../bin/commands/deploy-check';

describe('Stateless Scale-Out: InMemoryRedisClient', () => {
  let redis;

  beforeEach(() => {
    redis = new InMemoryRedisClient();
  });

  afterEach(async () => {
    await redis.quit();
  });

  it('supports basic get, set, and del', async () => {
    expect(await redis.get('nonexistent')).toBeNull();

    await redis.set('k1', 'val1');
    expect(await redis.get('k1')).toBe('val1');

    const delCount = await redis.del('k1');
    expect(delCount).toBe(1);
    expect(await redis.get('k1')).toBeNull();
  });

  it('supports TTL and expiration', async () => {
    await redis.set('k2', 'val2', 'EX', 10);
    expect(await redis.get('k2')).toBe('val2');

    const remaining = await redis.ttl('k2');
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(10);

    await redis.expire('k2', 60);
    const updated = await redis.ttl('k2');
    expect(updated).toBeGreaterThan(10);
  });

  it('supports object-based EX option in set', async () => {
    await redis.set('k_obj', 'val_obj', { ex: 30 });
    expect(await redis.get('k_obj')).toBe('val_obj');
    expect(await redis.ttl('k_obj')).toBeGreaterThan(0);
  });

  it('supports set operations: sadd, smembers, sismember, srem', async () => {
    expect(await redis.sadd('set1', 'm1', 'm2')).toBe(2);
    expect(await redis.sadd('set1', 'm1')).toBe(0); // already exists

    expect(await redis.sismember('set1', 'm1')).toBe(1);
    expect(await redis.sismember('set1', 'm3')).toBe(0);

    const members = await redis.smembers('set1');
    expect(members).toContain('m1');
    expect(members).toContain('m2');

    expect(await redis.srem('set1', 'm1')).toBe(1);
    expect(await redis.sismember('set1', 'm1')).toBe(0);
  });

  it('supports keys matching, ping, and quit', async () => {
    await redis.set('prefix:a', '1');
    await redis.set('prefix:b', '2');
    await redis.set('other:c', '3');

    const matched = await redis.keys('prefix:*');
    expect(matched).toHaveLength(2);
    expect(matched).toContain('prefix:a');
    expect(matched).toContain('prefix:b');

    expect(await redis.ping()).toBe('PONG');
  });
});

describe('Stateless Scale-Out: MiniRedisClient RESP Protocol Parser', () => {
  const client = new MiniRedisClient('redis://localhost:6379');

  it('parses simple strings (+)', () => {
    const res = client._parseResp('+OK\r\n');
    expect(res).toEqual({ value: 'OK', bytesRead: 5 });
  });

  it('parses errors (-)', () => {
    const res = client._parseResp('-ERR unknown command\r\n');
    expect(res).toEqual({ value: 'ERR unknown command', bytesRead: 22, isError: true });
  });

  it('parses integers (:)', () => {
    const res = client._parseResp(':1024\r\n');
    expect(res).toEqual({ value: 1024, bytesRead: 7 });
  });

  it('parses bulk strings ($)', () => {
    const res = client._parseResp('$5\r\nhello\r\n');
    expect(res).toEqual({ value: 'hello', bytesRead: 11 });

    const nullRes = client._parseResp('$-1\r\n');
    expect(nullRes).toEqual({ value: null, bytesRead: 5 });
  });

  it('parses arrays (*)', () => {
    const res = client._parseResp('*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n');
    expect(res).toEqual({ value: ['foo', 'bar'], bytesRead: 22 });

    const nullArray = client._parseResp('*-1\r\n');
    expect(nullArray).toEqual({ value: null, bytesRead: 5 });
  });

  it('returns null for incomplete buffer', () => {
    expect(client._parseResp('$10\r\nshort')).toBeNull();
    expect(client._parseResp('+INCOMPLETE')).toBeNull();
  });

  it('creates client with URL parser or memory option', () => {
    const memClient = createMiniRedisClient({ inMemory: true });
    expect(memClient).toBeInstanceOf(InMemoryRedisClient);

    const tcpClient = createMiniRedisClient('redis://:secret123@redis.internal:6380/2');
    expect(tcpClient.host).toBe('redis.internal');
    expect(tcpClient.port).toBe(6380);
    expect(tcpClient.password).toBe('secret123');
    expect(tcpClient.db).toBe(2);
  });
});

describe('Stateless Scale-Out: RedisSessionStore', () => {
  let store;
  let client;

  beforeEach(() => {
    client = new InMemoryRedisClient();
    store = createRedisSessionStore({ client, prefix: 'test:sess:' });
  });

  afterEach(async () => {
    await store.close();
  });

  it('implements express-session store contract (get, set, destroy, touch)', async () => {
    const sid = 'sess_abc123';
    const sessionData = {
      cookie: { originalMaxAge: 3600000, maxAge: 3600000 },
      user: { id: 42, email: 'user@example.com' },
    };

    // 1. Set session
    await new Promise((resolve, reject) => {
      store.set(sid, sessionData, (err) => (err ? reject(err) : resolve()));
    });

    // 2. Get session
    const retrieved = await new Promise((resolve, reject) => {
      store.get(sid, (err, sess) => (err ? reject(err) : resolve(sess)));
    });
    expect(retrieved).toBeDefined();
    expect(retrieved.user.id).toBe(42);
    expect(retrieved.user.email).toBe('user@example.com');

    // 3. Touch session
    await new Promise((resolve, reject) => {
      store.touch(sid, sessionData, (err) => (err ? reject(err) : resolve()));
    });

    // 4. Length and All
    const len = await new Promise((resolve) => store.length((_, l) => resolve(l)));
    expect(len).toBe(1);

    const all = await new Promise((resolve) => store.all((_, a) => resolve(a)));
    expect(all).toHaveLength(1);
    expect(all[0].user.id).toBe(42);

    // 5. Destroy session
    await new Promise((resolve) => store.destroy(sid, resolve));
    const afterDestroy = await new Promise((resolve) => store.get(sid, (_, s) => resolve(s)));
    expect(afterDestroy).toBeNull();
  });

  it('supports clear() to wipe all sessions', async () => {
    await new Promise((resolve) => store.set('s1', { foo: 1 }, resolve));
    await new Promise((resolve) => store.set('s2', { foo: 2 }, resolve));

    expect(await new Promise((r) => store.length((_, l) => r(l)))).toBe(2);

    await new Promise((resolve) => store.clear(resolve));
    expect(await new Promise((r) => store.length((_, l) => r(l)))).toBe(0);
  });
});

describe('Stateless Scale-Out: RedisSessionTracker', () => {
  let tracker;
  let client;

  beforeEach(() => {
    client = new InMemoryRedisClient();
    tracker = createRedisSessionTracker({ client, prefix: 'test:tracker:' });
  });

  it('tracks, touches, and lists device sessions for a user', async () => {
    const rec1 = await tracker.track('sess_1', 100, {
      ip: '192.168.1.10',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    });

    expect(rec1).toBeDefined();
    expect(rec1.user_id).toBe(100);
    expect(rec1.session_id).toBe('sess_1');

    // Touch
    const touched = await tracker.touch('sess_1');
    expect(touched).toBe(true);

    // Track a second session for same user
    await tracker.track('sess_2', 100, {
      ip: '10.0.0.1',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    });

    // List sessions
    const list = await tracker.list(100, 'sess_1');
    expect(list).toHaveLength(2);
    const current = list.find((s) => s.session_id === 'sess_1');
    expect(current.is_current).toBe(true);

    const other = list.find((s) => s.session_id === 'sess_2');
    expect(other.is_current).toBe(false);

    // Validation
    expect(await tracker.isSessionValid('sess_1', 100)).toBe(true);
    expect(await tracker.isSessionValid('sess_1', 999)).toBe(false);
  });

  it('revokes single, other, and all sessions', async () => {
    await tracker.track('s1', 200);
    await tracker.track('s2', 200);
    await tracker.track('s3', 200);

    expect(await tracker.list(200)).toHaveLength(3);

    // Revoke s1
    await tracker.revoke('s1');
    expect(await tracker.isSessionValid('s1')).toBe(false);
    expect(await tracker.list(200)).toHaveLength(2);

    // Revoke others keeping s2
    const revokedOthers = await tracker.revokeOthers(200, 's2');
    expect(revokedOthers).toBe(1);
    const remaining = await tracker.list(200);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].session_id).toBe('s2');

    // Revoke all
    await tracker.revokeAll(200);
    expect(await tracker.list(200)).toHaveLength(0);
  });
});

describe('Stateless Scale-Out: Serverless DB Connection Pool Optimizer', () => {
  it('detects serverless environments correctly', () => {
    expect(isServerlessEnvironment({}).isServerless).toBe(false);

    expect(isServerlessEnvironment({ K_SERVICE: 'web-prod' })).toEqual({
      isServerless: true,
      platform: 'cloudrun',
    });

    expect(isServerlessEnvironment({ AWS_LAMBDA_FUNCTION_NAME: 'api-handler' })).toEqual({
      isServerless: true,
      platform: 'aws-lambda',
    });

    expect(isServerlessEnvironment({ AWS_EXECUTION_ENV: 'AWS_ECS_FARGATE' })).toEqual({
      isServerless: true,
      platform: 'ecs',
    });

    expect(isServerlessEnvironment({ SERVERLESS: 'true' })).toEqual({
      isServerless: true,
      platform: 'serverless',
    });
  });

  it('leaves SQLite and D1 pools untouched', () => {
    const sqliteConfig = { client: 'better-sqlite3', connection: ':memory:' };
    const normalized = normalizeServerlessPoolConfig(sqliteConfig, { K_SERVICE: 'app' });
    expect(normalized).toBe(sqliteConfig);
  });

  it('optimizes Postgres/MySQL connection pool in Cloud Run', () => {
    const pgConfig = {
      client: 'pg',
      connection: 'postgres://postgres:secret@db:5432/app',
      pool: { min: 2, max: 20 },
    };

    const normalized = normalizeServerlessPoolConfig(pgConfig, { K_SERVICE: 'prod-api' });

    expect(normalized.pool.serverless).toBe(true);
    expect(normalized.pool.min).toBe(2); // Retains user specified min if explicitly set
    expect(normalized.pool.max).toBe(20);
    expect(normalized.pool.idleTimeoutMillis).toBe(30000);
    expect(normalized.pool.acquireTimeoutMillis).toBe(10000);
  });

  it('applies serverless default min: 0 and max: 5 when no pool is specified', () => {
    const pgConfig = {
      client: 'pg',
      connection: 'postgres://localhost/app',
    };

    const normalized = normalizeServerlessPoolConfig(pgConfig, { K_SERVICE: 'prod-api' });

    expect(normalized.pool.min).toBe(0);
    expect(normalized.pool.max).toBe(5);
    expect(normalized.pool.acquireTimeoutMillis).toBe(10000);
    expect(normalized.pool.propagateCreateError).toBe(false);
  });

  it('applies max: 2 for AWS Lambda serverless execution', () => {
    const mysqlConfig = {
      client: 'mysql2',
      connection: 'mysql://localhost/app',
    };

    const normalized = normalizeServerlessPoolConfig(mysqlConfig, { AWS_LAMBDA_FUNCTION_NAME: 'fn' });
    expect(normalized.pool.min).toBe(0);
    expect(normalized.pool.max).toBe(2);
  });

  it('respects explicit serverless: false opt-out', () => {
    const pgConfig = {
      client: 'pg',
      connection: 'postgres://localhost/app',
      pool: { min: 5, max: 25, serverless: false },
    };

    const normalized = normalizeServerlessPoolConfig(pgConfig, { K_SERVICE: 'prod-api' });
    expect(normalized.pool.serverless).toBe(false);
    expect(normalized.pool.min).toBe(5);
    expect(normalized.pool.max).toBe(25);
  });
});

describe('Stateless Scale-Out: Deployment Preflight Check Audit', () => {
  it('detects Redis distributed session store in preflight check', async () => {
    const result = await runDeployCheck({
      cwd: process.cwd(),
      env: 'production',
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.successes)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});

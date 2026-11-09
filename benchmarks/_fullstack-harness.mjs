/**
 * Shared harness: boots `examples/fullstack-app` on an ephemeral port so every benchmark
 * measures the framework through a realistic, feature-complete application
 * (SSR + loaders, file-based API, services, ORM relations, JWT, compression, metrics...).
 *
 * Not a bench file itself (vitest only collects `*.bench.mjs`).
 */

import { createRequire } from 'node:module';
import { once } from 'node:events';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);

// Measure production behavior. Vitest runs with NODE_ENV=test, which disables the Nunjucks
// template cache (noCache) and other production caches — benchmarking that would mostly
// measure template recompilation and disk reads. Set before the app modules are loaded.
process.env.NODE_ENV = process.env.BENCH_NODE_ENV || 'production';
// Production enforces strong secrets; use a fresh random one per run.
process.env.APP_SECRET ??= crypto.randomBytes(32).toString('hex');

// Lift the example's rate limits before its limiter modules are loaded.
process.env.LOGIN_RATE_LIMIT ??= '100000000';
process.env.WRITE_RATE_LIMIT ??= '100000000';

export const DEMO_EMAIL = 'admin@example.com';
export const DEMO_PASSWORD = 'secret-password';

/** Fixed dataset so results stay comparable across runs and machines. */
export const BENCH_SEED = { users: 10, posts: 200, commentsPerPost: 3, password: DEMO_PASSWORD };

/**
 * @param {{ listen?: boolean }} [opts] - set `listen: false` for in-process (service / ORM) benches
 */
export async function bootFullstack(opts = {}) {
  const { createFullstackApp } = require('../examples/fullstack-app/app.js');
  const ctx = await createFullstackApp({
    seed: BENCH_SEED,
    logging: false,
    queueAutoStart: false,
  });

  const samplePost = (await ctx.app.service('post.list', { page: 1, perPage: 1 })).data[0];

  if (opts.listen === false) {
    return { ...ctx, samplePost, stop: ctx.close };
  }

  const server = ctx.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  /**
   * Issue a request and fully drain the body (keep-alive connection reuse via undici).
   * Throws on unexpected status so a broken route can never report a "fast" result.
   */
  async function request(path, init = {}, expectStatus = 200) {
    const res = await fetch(base + path, { redirect: 'manual', ...init });
    await res.arrayBuffer();
    if (res.status !== expectStatus) {
      throw new Error(`${init.method || 'GET'} ${path} → ${res.status} (expected ${expectStatus})`);
    }
    return res;
  }

  async function login() {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
    });
    if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
    return (await res.json()).accessToken;
  }

  async function stop() {
    await new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
    await ctx.close();
  }

  return { ...ctx, base, server, samplePost, request, login, stop };
}


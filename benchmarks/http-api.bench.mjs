/**
 * End-to-end JSON API benchmarks against examples/fullstack-app.
 */

import { afterAll, bench, describe } from 'vitest';
import { bootFullstack } from './_fullstack-harness.mjs';

const app = await bootFullstack();
afterAll(() => app.stop());

const slug = app.samplePost.slug;
const token = await app.login();
const authHeaders = { authorization: `Bearer ${token}` };
const jsonAuthHeaders = { ...authHeaders, 'content-type': 'application/json' };
const validPost = JSON.stringify({ title: 'Benchmark post', body: 'Benchmark body '.repeat(20), categoryId: 1 });
const invalidPost = JSON.stringify({ title: 'x', categoryId: 'nope' });

describe('API: reads (fullstack-app)', () => {
  bench('GET /api/posts — query schema + service + paginate + include', async () => {
    await app.request('/api/posts?page=2&perPage=10');
  });

  bench('GET /api/posts/:slug — params schema + nested eager loading', async () => {
    await app.request(`/api/posts/${slug}`);
  });

  bench('GET /api/categories — memoized service', async () => {
    await app.request('/api/categories');
  });

  bench('GET /api/stats — memoized aggregate counts', async () => {
    await app.request('/api/stats');
  });
});

describe('API: auth (fullstack-app)', () => {
  bench('GET /api/me — JWT verification + user lookup', async () => {
    await app.request('/api/me', { headers: authHeaders });
  });

  bench('GET /api/me — rejected without token (401)', async () => {
    await app.request('/api/me', {}, 401);
  });
});

describe('API: writes (fullstack-app)', () => {
  bench('POST /api/posts — JWT + rate limit + Zod + transactional service + event + job', async () => {
    await app.request('/api/posts', { method: 'POST', headers: jsonAuthHeaders, body: validPost }, 201);
  });

  bench('POST /api/posts — Zod validation failure (400)', async () => {
    await app.request('/api/posts', { method: 'POST', headers: jsonAuthHeaders, body: invalidPost }, 400);
  });
});


/**
 * End-to-end SSR benchmarks against examples/fullstack-app.
 *
 * Every request travels the full stack: HTTP → middleware (security headers, metrics,
 * request context) → file router → loader → services → ORM/SQLite → Nunjucks → response.
 */

import { afterAll, bench, describe } from 'vitest';
import { bootFullstack } from './_fullstack-harness.mjs';

const app = await bootFullstack();
afterAll(() => app.stop());

const slug = app.samplePost.slug;

describe('SSR: page rendering (fullstack-app)', () => {
  bench('GET /about — static template, no loader', async () => {
    await app.request('/about');
  });

  bench('GET / — 3 composed services (2 memoized) + partials', async () => {
    await app.request('/');
  });

  bench('GET /posts?page=3 — paginated ORM query + eager loading', async () => {
    await app.request('/posts?page=3');
  });

  bench('GET /posts?category=engineering — filtered listing', async () => {
    await app.request('/posts?category=engineering');
  });

  bench('GET /posts/:slug — detail with author, category, comments', async () => {
    await app.request(`/posts/${slug}`);
  });

  bench('GET /does-not-exist — custom 404 template', async () => {
    await app.request('/does-not-exist', {}, 404);
  });
});


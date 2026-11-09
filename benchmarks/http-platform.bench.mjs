/**
 * Platform / middleware overhead benchmarks against examples/fullstack-app:
 * health probes, metrics exposition, redirects, CORS preflight and response compression.
 */

import { afterAll, bench, describe } from 'vitest';
import { bootFullstack } from './_fullstack-harness.mjs';

const app = await bootFullstack();
afterAll(() => app.stop());

describe('Platform: probes & plugins (fullstack-app)', () => {
  bench('GET /healthz — liveness probe (pipeline floor)', async () => {
    await app.request('/healthz');
  });

  bench('GET /readyz — readiness probe (DB + queue checks)', async () => {
    await app.request('/readyz');
  });

  bench('GET /metrics — Prometheus exposition', async () => {
    await app.request('/metrics');
  });

  bench('GET /blog — redirectPlugin 301', async () => {
    await app.request('/blog', {}, 301);
  });

  bench('OPTIONS /api/posts — corsPlugin preflight', async () => {
    await app.request('/api/posts', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://client.example.com',
        'access-control-request-method': 'POST',
      },
    }, 204);
  });
});

describe('Platform: response compression on GET /posts (fullstack-app)', () => {
  bench('identity', async () => {
    await app.request('/posts', { headers: { 'accept-encoding': 'identity' } });
  });

  bench('gzip', async () => {
    await app.request('/posts', { headers: { 'accept-encoding': 'gzip' } });
  });

  bench('br', async () => {
    await app.request('/posts', { headers: { 'accept-encoding': 'br' } });
  });
});


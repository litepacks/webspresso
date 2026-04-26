/**
 * Microbenchmarks: routeRegistrationMeta, compareRouteRegistrationOrder
 */

import { bench, describe } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { routeRegistrationMeta, compareRouteRegistrationOrder } = require('../src/file-router.js');

const samples = [
  '/',
  '/about',
  '/users/:id',
  '/posts/:slug/comments/:cid',
  '/docs/*',
  '/api/v2/items/:itemId/sub',
];

const pairA = { routePath: '/users/:id/posts' };
const pairB = { routePath: '/users/:id' };

describe('routeRegistrationMeta', () => {
  bench('static + dynamic + catch-all mix', () => {
    for (const p of samples) routeRegistrationMeta(p);
  });
});

describe('compareRouteRegistrationOrder', () => {
  bench('two dynamic routes', () => {
    compareRouteRegistrationOrder(pairA, pairB);
  });
});

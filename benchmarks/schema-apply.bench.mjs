/**
 * Microbenchmarks: Zod validation path via applySchema
 */

import { bench, describe } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const z = require('zod');
const { applySchema } = require('../core/applySchema.js');

const compiled = {
  body: z.object({
    name: z.string(),
    count: z.coerce.number().int(),
  }),
  query: z.object({
    q: z.string().optional(),
  }),
  params: z.object({
    id: z.string(),
  }),
};

describe('applySchema', () => {
  bench('body + query + params', () => {
    const req = {
      body: { name: 'item', count: 42 },
      query: { q: 'search' },
      params: { id: 'x-99' },
    };
    applySchema(req, compiled);
  });

  bench('no schema (early return)', () => {
    const req = { body: {}, query: {}, params: {} };
    applySchema(req, null);
  });
});

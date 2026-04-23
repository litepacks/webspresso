/**
 * Microbenchmarks: compileSchema (uncached each iteration vs cache hit)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bench, beforeAll, describe } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compileSchema, clearAllSchemas } = require('../core/compileSchema.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DUMMY_API_PATH = path.join(__dirname, '_bench_schema_dummy.js');

const apiModule = {
  schema: ({ z }) => ({
    body: z.object({
      title: z.string().min(1),
      tags: z.array(z.string()).optional(),
    }),
    query: z.object({
      limit: z.coerce.number().int().positive().optional(),
    }),
  }),
};

describe('compileSchema', () => {
  beforeAll(() => {
    clearAllSchemas();
  });

  bench('cold (clear + compile)', () => {
    clearAllSchemas();
    compileSchema(DUMMY_API_PATH, apiModule);
  });

  bench('warm (cache hit)', () => {
    compileSchema(DUMMY_API_PATH, apiModule);
  });
});

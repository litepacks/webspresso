/**
 * Microbenchmarks: ORM cache fingerprint + nanoid (hot read paths)
 */

import { bench, describe } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { stableValue, serializeWheres, hashKey } = require('../core/orm/cache/fingerprint.js');
const { createScopeContext } = require('../core/orm/scopes.js');
const { generateNanoid } = require('../core/orm/utils/nanoid.js');

const model = { name: 'Article', table: 'articles', primaryKey: 'id' };
const scope = createScopeContext();
const nested = { z: 1, a: { b: 2, c: [3, 1, 2] } };
const wheres = [
  { column: 'status', operator: '=', value: 'published', boolean: 'and' },
  { column: 'author_id', operator: '=', value: 42, boolean: 'and' },
];
const qbParts = {
  op: 'list',
  selects: ['id', 'title'].sort(),
  wheres: serializeWheres(wheres),
  orderBys: [{ column: 'created_at', direction: 'desc' }],
  limit: 20,
  offset: 0,
  withs: ['author'].sort(),
  extra: {},
};

describe('cache fingerprint', () => {
  bench('stableValue (nested object)', () => {
    stableValue(nested);
  });

  bench('hashKey (query-style parts)', () => {
    hashKey(model, scope, qbParts);
  });
});

describe('generateNanoid', () => {
  bench('default length (21)', () => {
    generateNanoid();
  });

  bench('short id (8)', () => {
    generateNanoid(8);
  });
});

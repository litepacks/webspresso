/**
 * Microbenchmarks: ORM helpers — scopes, query builder (SQL compile), utils, schema columns
 */

import { afterAll, bench, beforeAll, describe } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const knex = require('knex');
const { createQueryBuilder } = require('../core/orm/query-builder.js');
const { createScopeContext, applyScopes } = require('../core/orm/scopes.js');
const { pick, omit, ensureArray, deepClone, sanitizeForOutput } = require('../core/orm/utils.js');
const { extractColumnsFromSchema } = require('../core/orm/schema-helpers.js');
const { zdb } = require('../core/orm/index.js');

/** Minimal model for QueryBuilder / applyScopes (no soft-delete, tenant, JSON) */
const benchModel = {
  name: 'BenchPost',
  table: 'posts',
  primaryKey: 'id',
  columns: new Map([
    ['id', { type: 'integer' }],
    ['status', { type: 'string' }],
  ]),
  scopes: {
    softDelete: false,
    timestamps: false,
    tenant: null,
  },
};

const benchModelSoft = {
  name: 'BenchPostSoft',
  table: 'posts',
  primaryKey: 'id',
  columns: new Map([['id', { type: 'integer' }]]),
  scopes: {
    softDelete: true,
    timestamps: false,
    tenant: null,
  },
};

const benchModelTenant = {
  name: 'BenchPostTenant',
  table: 'posts',
  primaryKey: 'id',
  columns: new Map([['id', { type: 'integer' }]]),
  scopes: {
    softDelete: false,
    timestamps: false,
    tenant: 'tenant_id',
  },
};

const zodSchema = zdb.schema({
  id: zdb.id(),
  title: zdb.string({ maxLength: 200 }),
  body: zdb.string({ nullable: true }),
  count: zdb.integer({ default: 0 }),
});

const sampleRecord = {
  id: 1,
  email: 'user@example.com',
  password: 'secret',
  token: 'tok',
  name: 'U',
};

const sampleObj = { a: 1, b: { c: 2 }, d: [3, 4] };

let kx;
let qbBase;
let qbSoft;
let qbTenant;

describe('ORM general (scopes, QueryBuilder, utils, schema)', () => {
  beforeAll(() => {
    kx = knex({ client: 'better-sqlite3', connection: ':memory:', useNullAsDefault: true });
    qbBase = () => createQueryBuilder(benchModel, kx, createScopeContext(), null);
    qbSoft = () => createQueryBuilder(benchModelSoft, kx, createScopeContext(), null);
    qbTenant = () => createQueryBuilder(benchModelTenant, kx, createScopeContext(), null);
  });

  afterAll(async () => {
    if (kx) await kx.destroy();
  });

  bench('createScopeContext', () => {
    createScopeContext();
  });

  bench('applyScopes on knex(posts) — no-op scopes', () => {
    const qb = kx('posts');
    applyScopes(qb, createScopeContext(), benchModel);
  });

  bench('QueryBuilder: where + whereIn + orderBy + limit → toSQL()', () => {
    qbBase()
      .where('status', 'published')
      .where('views', '>', 10)
      .whereIn('id', [1, 2, 3])
      .orderBy('created_at', 'desc')
      .orderBy('id', 'asc')
      .limit(20)
      .offset(5)
      .toKnex()
      .toSQL();
  });

  bench('QueryBuilder: clone + toSQL()', () => {
    qbBase().where('a', 1).orderBy('b', 'desc').clone().toKnex().toSQL();
  });

  bench('QueryBuilder: object where + orWhere + raw', () => {
    qbBase()
      .where({ status: 'published', kind: 'article' })
      .where('min_score', '>=', 5)
      .orWhere('featured', true)
      .whereRaw('length(title) > ?', [2])
      .orWhereRaw('pinned = ?', [1])
      .toKnex()
      .toSQL();
  });

  bench('QueryBuilder: whereNotIn + whereNull + whereNotNull', () => {
    qbBase()
      .whereNotIn('state', ['archived', 'banned'])
      .whereNull('deleted_reason')
      .whereNotNull('published_at')
      .toKnex()
      .toSQL();
  });

  bench('QueryBuilder: toKnex({ includeLimitOffset: false })', () => {
    qbBase()
      .where('x', 1)
      .limit(10)
      .offset(20)
      .toKnex({ includeLimitOffset: false })
      .toSQL();
  });

  bench('QueryBuilder: soft-delete default scope → toSQL()', () => {
    qbSoft().where('active', 1).toKnex().toSQL();
  });

  bench('QueryBuilder: withTrashed + where → toSQL()', () => {
    qbSoft().withTrashed().where('id', '>', 0).toKnex().toSQL();
  });

  bench('QueryBuilder: onlyTrashed → toSQL()', () => {
    qbSoft().onlyTrashed().orderBy('id', 'desc').toKnex().toSQL();
  });

  bench('QueryBuilder: forTenant + where → toSQL()', () => {
    qbTenant().forTenant(42).where('status', 'open').toKnex().toSQL();
  });

  bench('utils: pick + omit', () => {
    pick(sampleRecord, ['id', 'email']);
    omit(sampleRecord, ['password', 'token']);
  });

  bench('utils: ensureArray', () => {
    ensureArray('x');
    ensureArray(['a', 'b']);
  });

  bench('utils: deepClone (small object)', () => {
    deepClone(sampleObj);
  });

  bench('utils: sanitizeForOutput (hidden fields)', () => {
    sanitizeForOutput(sampleRecord, {
      hidden: ['password', 'token'],
    });
  });

  bench('extractColumnsFromSchema (zdb 4 fields)', () => {
    extractColumnsFromSchema(zodSchema);
  });
});

/**
 * Standard ORM & Database Mocks for Tests
 * Provides comprehensive mock repositories, query builders, and database instances.
 * @module tests/utils/orm
 */

/**
 * Creates a mock QueryBuilder.
 * Supports chaining, in-memory filtering, and Vitest spy inspection.
 *
 * @param {Object} [options={}]
 * @param {Array<Object>} [options.items=[]] - Initial items to query in-memory
 * @returns {Object} Mock QueryBuilder
 */
function createMockQueryBuilder(options = {}) {
  const items = (options.items || []).map((it) => ({ ...it }));
  const calls = [];

  const record = (method, ...args) => {
    const entry = { method };
    if (args.length > 0) entry.col = args[0];
    if (args.length > 1) entry.val = args[1];
    calls.push(entry);
  };

  const isSpy = typeof vi !== 'undefined' && typeof vi.fn === 'function';
  const makeChain = (fn) => (isSpy ? vi.fn(fn) : fn);

  let currentItems = [...items];

  const qb = {
    _items: currentItems,
    calls,

    getCalls(methodName) {
      if (!methodName) return [...calls];
      return calls.filter((c) => c.method === methodName);
    },

    where: makeChain(function where(colOrObj, opOrVal, maybeVal) {
      record('where', colOrObj, opOrVal, maybeVal);
      if (typeof colOrObj === 'object' && colOrObj !== null) {
        currentItems = currentItems.filter((row) =>
          Object.entries(colOrObj).every(([k, v]) => String(row[k]) === String(v))
        );
      } else if (maybeVal !== undefined) {
        // e.g. where('age', '>', 18)
        const op = opOrVal;
        const val = maybeVal;
        if (op === '=') currentItems = currentItems.filter((r) => r[colOrObj] === val);
        else if (op === '>') currentItems = currentItems.filter((r) => r[colOrObj] > val);
        else if (op === '>=') currentItems = currentItems.filter((r) => r[colOrObj] >= val);
        else if (op === '<') currentItems = currentItems.filter((r) => r[colOrObj] < val);
        else if (op === '<=') currentItems = currentItems.filter((r) => r[colOrObj] <= val);
        else if (op === '!=' || op === '<>') currentItems = currentItems.filter((r) => r[colOrObj] !== val);
      } else if (opOrVal !== undefined) {
        // e.g. where('id', 1)
        currentItems = currentItems.filter((r) => String(r[colOrObj]) === String(opOrVal));
      }
      qb._items = currentItems;
      return qb;
    }),

    orWhere: makeChain(function orWhere(...args) {
      record('orWhere', ...args);
      return qb;
    }),

    whereIn: makeChain(function whereIn(col, values = []) {
      record('whereIn', col, values);
      const strVals = values.map(String);
      currentItems = currentItems.filter((r) => strVals.includes(String(r[col])));
      qb._items = currentItems;
      return qb;
    }),

    whereNotIn: makeChain(function whereNotIn(col, values = []) {
      record('whereNotIn', col, values);
      const strVals = values.map(String);
      currentItems = currentItems.filter((r) => !strVals.includes(String(r[col])));
      qb._items = currentItems;
      return qb;
    }),

    whereNull: makeChain(function whereNull(col) {
      record('whereNull', col);
      currentItems = currentItems.filter((r) => r[col] === null || r[col] === undefined);
      qb._items = currentItems;
      return qb;
    }),

    whereNotNull: makeChain(function whereNotNull(col) {
      record('whereNotNull', col);
      currentItems = currentItems.filter((r) => r[col] !== null && r[col] !== undefined);
      qb._items = currentItems;
      return qb;
    }),

    whereBetween: makeChain(function whereBetween(col, [min, max]) {
      record('whereBetween', col, [min, max]);
      currentItems = currentItems.filter((r) => r[col] >= min && r[col] <= max);
      qb._items = currentItems;
      return qb;
    }),

    whereNot: makeChain(function whereNot(col, val) {
      record('whereNot', col, val);
      currentItems = currentItems.filter((r) => String(r[col]) !== String(val));
      qb._items = currentItems;
      return qb;
    }),

    select: makeChain(function select(...cols) {
      record('select', ...cols);
      return qb;
    }),

    orderBy: makeChain(function orderBy(col, direction = 'asc') {
      record('orderBy', col, direction);
      const dir = direction.toLowerCase() === 'desc' ? -1 : 1;
      currentItems.sort((a, b) => {
        if (a[col] < b[col]) return -1 * dir;
        if (a[col] > b[col]) return 1 * dir;
        return 0;
      });
      qb._items = currentItems;
      return qb;
    }),

    offset: makeChain(function offset(n) {
      record('offset', n);
      currentItems = currentItems.slice(n);
      qb._items = currentItems;
      return qb;
    }),

    limit: makeChain(function limit(n) {
      record('limit', n);
      currentItems = currentItems.slice(0, n);
      qb._items = currentItems;
      return qb;
    }),

    include: makeChain(function include(...relations) {
      record('include', ...relations);
      return qb;
    }),

    withTrashed: makeChain(function withTrashed() {
      record('withTrashed');
      return qb;
    }),

    onlyTrashed: makeChain(function onlyTrashed() {
      record('onlyTrashed');
      currentItems = currentItems.filter((r) => Boolean(r.deleted_at));
      qb._items = currentItems;
      return qb;
    }),

    forTenant: makeChain(function forTenant(tenantId) {
      record('forTenant', tenantId);
      currentItems = currentItems.filter((r) => String(r.tenant_id) === String(tenantId));
      qb._items = currentItems;
      return qb;
    }),

    forUser: makeChain(function forUser(userId) {
      record('forUser', userId);
      currentItems = currentItems.filter((r) => String(r.user_id) === String(userId));
      qb._items = currentItems;
      return qb;
    }),

    modify: makeChain(function modify(fn) {
      record('modify');
      if (typeof fn === 'function') fn(qb);
      return qb;
    }),

    clone: makeChain(function clone() {
      record('clone');
      return createMockQueryBuilder({ items: currentItems });
    }),

    first: makeChain(async function first() {
      record('first');
      return currentItems[0] ? { ...currentItems[0] } : null;
    }),

    find: makeChain(async function find() {
      record('find');
      return currentItems.map((it) => ({ ...it }));
    }),

    list: makeChain(async function list() {
      record('list');
      return currentItems.map((it) => ({ ...it }));
    }),

    count: makeChain(async function count() {
      record('count');
      return currentItems.length;
    }),

    paginate: makeChain(async function paginate({ page = 1, limit = 10 } = {}) {
      record('paginate', { page, limit });
      const total = currentItems.length;
      const totalPages = Math.ceil(total / limit) || 1;
      const start = (page - 1) * limit;
      const pagedData = currentItems.slice(start, start + limit).map((it) => ({ ...it }));
      return {
        data: pagedData,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasPrev: page > 1,
          hasNext: page < totalPages,
        },
      };
    }),
  };

  return qb;
}

/**
 * Creates a mock Repository.
 * Simulates CRUD operations in-memory and supports Vitest spy expectations.
 *
 * @param {Array<Object>|Object} [optionsOrItems=[]] - Initial items array or repository options
 * @returns {Object} Mock Repository
 */
function createMockRepo(optionsOrItems = []) {
  const isArray = Array.isArray(optionsOrItems);
  const initialItems = isArray ? optionsOrItems : optionsOrItems.items || [];
  const options = isArray ? {} : optionsOrItems;

  const items = initialItems.map((it) => ({ ...it }));
  let nextId = items.reduce((max, it) => Math.max(max, typeof it.id === 'number' ? it.id : 0), 0) + 1;

  const isSpy = typeof vi !== 'undefined' && typeof vi.fn === 'function';
  const makeFn = (fn) => (isSpy ? vi.fn(fn) : fn);

  const repo = {
    items,
    name: options.name || 'MockModel',
    model: {
      name: options.name || 'MockModel',
      table: options.table || 'mock_items',
      primaryKey: options.primaryKey || 'id',
      ...(options.model || {}),
    },

    findById: makeFn(async function findById(id) {
      const found = items.find((r) => String(r.id) === String(id));
      return found ? { ...found } : null;
    }),

    findOne: makeFn(async function findOne(criteria) {
      if (typeof criteria === 'function') {
        const found = items.find(criteria);
        return found ? { ...found } : null;
      }
      if (typeof criteria === 'object' && criteria !== null) {
        const found = items.find((r) =>
          Object.entries(criteria).every(([k, v]) => String(r[k]) === String(v))
        );
        return found ? { ...found } : null;
      }
      return items[0] ? { ...items[0] } : null;
    }),

    find: makeFn(async function find(criteria) {
      if (typeof criteria === 'function') {
        return items.filter(criteria).map((it) => ({ ...it }));
      }
      if (typeof criteria === 'object' && criteria !== null) {
        return items
          .filter((r) => Object.entries(criteria).every(([k, v]) => String(r[k]) === String(v)))
          .map((it) => ({ ...it }));
      }
      return items.map((it) => ({ ...it }));
    }),

    create: makeFn(async function create(data) {
      const created = {
        id: data.id !== undefined ? data.id : nextId++,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...data,
      };
      items.push(created);
      return { ...created };
    }),

    update: makeFn(async function update(id, data) {
      const index = items.findIndex((r) => String(r.id) === String(id));
      if (index === -1) return null;
      items[index] = {
        ...items[index],
        ...data,
        updated_at: new Date().toISOString(),
      };
      return { ...items[index] };
    }),

    delete: makeFn(async function del(id) {
      const index = items.findIndex((r) => String(r.id) === String(id));
      if (index === -1) return false;
      if (options.softDelete) {
        items[index].deleted_at = new Date().toISOString();
      } else {
        items.splice(index, 1);
      }
      return true;
    }),

    restore: makeFn(async function restore(id) {
      const found = items.find((r) => String(r.id) === String(id));
      if (!found) return null;
      found.deleted_at = null;
      return { ...found };
    }),

    count: makeFn(async function count(criteria) {
      if (criteria) {
        const list = await repo.find(criteria);
        return list.length;
      }
      return items.length;
    }),

    query: makeFn(function query() {
      return createMockQueryBuilder({ items });
    }),

    raw: makeFn(async function raw() {
      return [];
    }),

    forTenant: makeFn(function forTenant() {
      return repo;
    }),

    forUser: makeFn(function forUser() {
      return repo;
    }),

    withTrashed: makeFn(function withTrashed() {
      return repo;
    }),

    onlyTrashed: makeFn(function onlyTrashed() {
      return repo;
    }),

    transaction: makeFn(async function transaction(cb) {
      if (typeof cb === 'function') {
        return cb(repo);
      }
      return repo;
    }),

    ...options,
  };

  return repo;
}

/**
 * Creates a mock Database instance.
 * Automatically provisions repositories and provides Knex dialect simulation.
 *
 * @param {Object} [repositories={}] - Map of model names to Repository instances or item arrays
 * @param {Object} [options={}] - Custom database options
 * @returns {Object} Mock Database
 */
function createMockDb(repositories = {}, options = {}) {
  const repoStore = {};

  for (const [name, val] of Object.entries(repositories)) {
    if (val && typeof val.findById === 'function') {
      repoStore[name.toLowerCase()] = val;
      repoStore[name] = val;
    } else if (Array.isArray(val)) {
      const repo = createMockRepo({ name, items: val });
      repoStore[name.toLowerCase()] = repo;
      repoStore[name] = repo;
    } else {
      repoStore[name.toLowerCase()] = val;
      repoStore[name] = val;
    }
  }

  const isSpy = typeof vi !== 'undefined' && typeof vi.fn === 'function';

  const mockKnex = {
    client: {
      config: {
        client: options.dialect || 'sqlite3',
      },
    },
    schema: {
      hasTable: isSpy ? vi.fn().mockResolvedValue(true) : async () => true,
      createTable: isSpy ? vi.fn().mockResolvedValue() : async () => {},
      dropTable: isSpy ? vi.fn().mockResolvedValue() : async () => {},
    },
    fn: {
      now: isSpy ? vi.fn(() => new Date()) : () => new Date(),
    },
    raw: isSpy ? vi.fn().mockResolvedValue([]) : async () => [],
    isTransaction: false,
    commit: isSpy ? vi.fn().mockResolvedValue() : async () => {},
    rollback: isSpy ? vi.fn().mockResolvedValue() : async () => {},
  };

  const getRepositoryImpl = function getRepository(name) {
    if (!name) return null;
    const key = name.toLowerCase();
    if (repoStore[key]) return repoStore[key];
    if (repoStore[name]) return repoStore[name];

    if (options.autoCreate !== false) {
      const newRepo = createMockRepo({ name });
      repoStore[key] = newRepo;
      repoStore[name] = newRepo;
      return newRepo;
    }
    return null;
  };

  const mockDb = {
    knex: mockKnex,
    models: new Map(),

    getRepository: isSpy ? vi.fn(getRepositoryImpl) : getRepositoryImpl,

    transaction: isSpy
      ? vi.fn(async function transaction(cb) {
          if (typeof cb === 'function') {
            return cb(mockDb);
          }
          return mockDb;
        })
      : async function transaction(cb) {
          if (typeof cb === 'function') {
            return cb(mockDb);
          }
          return mockDb;
        },

    raw: isSpy ? vi.fn().mockResolvedValue([]) : async () => [],
    close: isSpy ? vi.fn().mockResolvedValue() : async () => {},
    ...options,
  };

  return mockDb;
}

module.exports = {
  createMockQueryBuilder,
  createMockRepo,
  createMockDb,
};

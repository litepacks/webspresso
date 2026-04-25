/**
 * ORM cache integration (createDatabase + repository + query builder)
 */
const { zdb, defineModel, clearRegistry, getModel, createDatabase } = require('../../../core/orm');

describe('ORM cache integration', () => {
  let db;

  beforeAll(async () => {
    clearRegistry();
    const WidgetSchema = zdb.schema({
      id: zdb.id(),
      name: zdb.string({ maxLength: 100 }),
    });

    defineModel({
      name: 'CacheWidget',
      table: 'cache_widgets',
      schema: WidgetSchema,
      cache: 'auto',
    });

    defineModel({
      name: 'SmartWidget',
      table: 'smart_widgets',
      schema: WidgetSchema,
      cache: 'smart',
    });

    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      models: './tests/fixtures/models-empty',
      cache: { enabled: true, defaultStrategy: 'auto' },
    });

    db.registerModel(getModel('CacheWidget'));
    db.registerModel(getModel('SmartWidget'));

    await db.knex.schema.createTable('cache_widgets', (t) => {
      t.increments('id').primary();
      t.string('name', 100);
    });
    await db.knex.schema.createTable('smart_widgets', (t) => {
      t.increments('id').primary();
      t.string('name', 100);
    });
  });

  afterAll(async () => {
    await db.destroy();
    clearRegistry();
  });

  beforeEach(async () => {
    await db.knex('cache_widgets').del();
    await db.knex('smart_widgets').del();
    db.cache.purge();
    db.cache.resetMetrics();
    await db.knex('cache_widgets').insert([
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
    ]);
    await db.knex('smart_widgets').insert([
      { id: 1, name: 'S1' },
      { id: 2, name: 'S2' },
    ]);
  });

  it('exposes db.cache API when enabled', () => {
    expect(db.cache).toBeTruthy();
    expect(typeof db.cache.getMetrics).toBe('function');
  });

  it('caches findById and increments hits', async () => {
    const repo = db.getRepository('CacheWidget');
    await repo.findById(1);
    await repo.findById(1);
    const m = db.cache.getMetrics();
    expect(m.misses).toBe(1);
    expect(m.hits).toBe(1);
  });

  it('bypasses cache inside transaction reads', async () => {
    const repo = db.getRepository('CacheWidget');
    await repo.findById(1);
    await db.transaction(async (trx) => {
      const r = trx.getRepository('CacheWidget');
      await r.findById(1);
      await r.findById(1);
    });
    const m = db.cache.getMetrics();
    expect(m.bypassed).toBeGreaterThanOrEqual(2);
  });

  it('invalidates on update (auto)', async () => {
    const repo = db.getRepository('CacheWidget');
    await repo.findById(1);
    await repo.update(1, { name: 'A2' });
    const m1 = db.cache.getMetrics();
    expect(m1.misses).toBeGreaterThanOrEqual(1);
    await repo.findById(1);
    const m2 = db.cache.getMetrics();
    expect(m2.misses).toBeGreaterThan(m1.misses);
  });

  it('smart: updating other row keeps pk cache for first row', async () => {
    const repo = db.getRepository('SmartWidget');
    await repo.findById(1);
    await repo.findById(1);
    let m = db.cache.getMetrics();
    expect(m.hits).toBe(1);

    await repo.update(2, { name: 'S2x' });

    await repo.findById(1);
    m = db.cache.getMetrics();
    expect(m.hits).toBe(2);
  });

  it('smart: updating same row busts pk cache', async () => {
    const repo = db.getRepository('SmartWidget');
    await repo.findById(1);
    await repo.update(1, { name: 'S1x' });
    db.cache.resetMetrics();
    await repo.findById(1);
    const m = db.cache.getMetrics();
    expect(m.misses).toBe(1);
    expect(m.hits).toBe(0);
  });

  it('query builder skips cache with whereRaw', async () => {
    const m0 = db.cache.getMetrics();
    await db.query('CacheWidget').whereRaw('id = ?', [1]).first();
    await db.query('CacheWidget').whereRaw('id = ?', [1]).first();
    const m1 = db.cache.getMetrics();
    expect(m1.bypassed - m0.bypassed).toBeGreaterThanOrEqual(2);
  });

  it('auto: findById for missing row does not cache null (two misses)', async () => {
    const repo = db.getRepository('CacheWidget');
    await repo.findById(999);
    await repo.findById(999);
    const m = db.cache.getMetrics();
    expect(m.misses).toBe(2);
    expect(m.sets).toBe(0);
  });

  it('auto: findAll is cached then invalidated by create', async () => {
    const repo = db.getRepository('CacheWidget');
    await repo.findAll();
    await repo.findAll();
    let m = db.cache.getMetrics();
    expect(m.misses).toBe(1);
    expect(m.hits).toBe(1);

    await repo.create({ name: 'New' });
    await repo.findAll();
    m = db.cache.getMetrics();
    expect(m.misses).toBe(2);
  });

  it('auto: delete invalidates cached reads', async () => {
    const repo = db.getRepository('CacheWidget');
    await repo.findById(2);
    await repo.findById(2);
    expect(db.cache.getMetrics().hits).toBe(1);

    await repo.delete(2);

    db.cache.resetMetrics();
    await repo.findById(2);
    const m = db.cache.getMetrics();
    expect(m.misses).toBe(1);
    expect(m.hits).toBe(0);
  });

  it('auto: updateWhere invalidates cache', async () => {
    const repo = db.getRepository('CacheWidget');
    await repo.findAll();
    await repo.findAll();
    expect(db.cache.getMetrics().hits).toBe(1);

    await repo.updateWhere({ id: 1 }, { name: 'A1' });

    db.cache.resetMetrics();
    await repo.findAll();
    expect(db.cache.getMetrics().misses).toBe(1);
  });

  it('auto: query().list() uses cache', async () => {
    await db.query('CacheWidget').orderBy('id').list();
    await db.query('CacheWidget').orderBy('id').list();
    const m = db.cache.getMetrics();
    expect(m.misses).toBe(1);
    expect(m.hits).toBe(1);
  });

  it('auto: query().count() uses cache', async () => {
    await db.query('CacheWidget').count();
    await db.query('CacheWidget').count();
    const m = db.cache.getMetrics();
    expect(m.misses).toBe(1);
    expect(m.hits).toBe(1);
  });

  it('db.cache.invalidateModel is safe for unknown model name', () => {
    expect(() => db.cache.invalidateModel('__NoSuchModel__')).not.toThrow();
  });

  it('auto: mutating SmartWidget does not clear CacheWidget cache', async () => {
    const rAuto = db.getRepository('CacheWidget');
    const rSmart = db.getRepository('SmartWidget');
    await rAuto.findById(1);
    await rAuto.findById(1);
    expect(db.cache.getMetrics().hits).toBe(1);

    await rSmart.update(1, { name: 'S1y' });

    await rAuto.findById(1);
    expect(db.cache.getMetrics().hits).toBe(2);
  });

  it('auto: forceDelete invalidates cache', async () => {
    await db.knex('cache_widgets').insert({ id: 99, name: 'Z' });
    const repo = db.getRepository('CacheWidget');
    await repo.findById(99);
    await repo.findById(99);
    expect(db.cache.getMetrics().hits).toBe(1);

    await repo.forceDelete(99);

    db.cache.resetMetrics();
    await repo.findById(99);
    expect(db.cache.getMetrics().misses).toBe(1);
  });

  it('auto: query().paginate() uses cache for same page', async () => {
    await db.query('CacheWidget').orderBy('id').paginate(1, 10);
    await db.query('CacheWidget').orderBy('id').paginate(1, 10);
    const m = db.cache.getMetrics();
    expect(m.misses).toBe(1);
    expect(m.hits).toBe(1);
  });
});

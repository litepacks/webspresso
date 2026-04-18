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
});

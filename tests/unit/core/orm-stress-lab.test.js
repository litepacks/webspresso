'use strict';

/**
 * Webspresso - Core ORM Stress Lab
 * Stress-tests query cache invalidation, ambient AsyncLocalStorage transactions & rollback,
 * N+1-free eager loading, soft-delete + tenant scopes + hidden fields, and bulk pagination.
 */

const {
  createDatabase,
  defineModel,
  zdb,
  clearRegistry,
  hasAmbientTransaction,
  omitHiddenColumns,
} = require('../../../core/orm');
const { onTransactionCommit } = require('../../../core/orm/transaction');

describe('Core ORM Stress Lab (Cache, Transactions, Eager Loading, Scopes, Pagination)', () => {
  let db;
  let Author;
  let Article;
  let ScopedSecret;

  beforeEach(async () => {
    clearRegistry();

    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      cache: { maxEntries: 500, defaultTtl: '5m' },
    });

    Author = defineModel({
      name: 'StressAuthor',
      table: 'stress_authors',
      cache: true,
      schema: {
        id: zdb.id(),
        name: zdb.string(),
        tier: zdb.string().default('free'),
      },
      relations: {
        articles: {
          type: 'hasMany',
          model: 'StressArticle',
          foreignKey: 'author_id',
        },
      },
    });

    Article = defineModel({
      name: 'StressArticle',
      table: 'stress_articles',
      cache: true,
      softDelete: true,
      timestamps: true,
      schema: {
        id: zdb.id(),
        author_id: zdb.integer(),
        title: zdb.string(),
        status: zdb.string().default('draft'),
        views: zdb.integer().default(0),
      },
      relations: {
        author: {
          type: 'belongsTo',
          model: 'StressAuthor',
          foreignKey: 'author_id',
        },
      },
    });

    ScopedSecret = defineModel({
      name: 'StressScopedSecret',
      table: 'stress_scoped_secrets',
      softDelete: true,
      hidden: ['secret_token'],
      schema: {
        id: zdb.id(),
        tenant_id: zdb.string(),
        label: zdb.string(),
        secret_token: zdb.string(),
      },
      scopes: {
        tenant: 'tenant_id',
        softDelete: true,
      },
    });

    db.registerModel(Author);
    db.registerModel(Article);
    db.registerModel(ScopedSecret);

    await db.knex.schema.createTable('stress_authors', (t) => {
      t.increments('id').primary();
      t.string('name').notNullable();
      t.string('tier').notNullable().defaultTo('free');
    });

    await db.knex.schema.createTable('stress_articles', (t) => {
      t.increments('id').primary();
      t.integer('author_id').notNullable();
      t.string('title').notNullable();
      t.string('status').notNullable().defaultTo('draft');
      t.integer('views').notNullable().defaultTo(0);
      t.timestamp('createdAt').nullable();
      t.timestamp('updatedAt').nullable();
      t.timestamp('deletedAt').nullable();
    });

    await db.knex.schema.createTable('stress_scoped_secrets', (t) => {
      t.increments('id').primary();
      t.string('tenant_id').notNullable();
      t.string('label').notNullable();
      t.string('secret_token').notNullable();
      t.timestamp('deletedAt').nullable();
    });
  });

  afterEach(async () => {
    if (db) {
      await db.destroy();
    }
    clearRegistry();
  });

  it('1. maintains query cache coherence across 150 bulk inserts, hits, updates, and soft-deletes', async () => {
    const authorRepo = db.getRepository('StressAuthor');
    const articleRepo = db.getRepository('StressArticle');

    const author = await authorRepo.create({ name: 'Ada', tier: 'pro' });

    for (let i = 0; i < 150; i++) {
      await articleRepo.create({
        author_id: author.id,
        title: `Article-${i}`,
        status: i % 2 === 0 ? 'published' : 'draft',
        views: i,
      });
    }

    // Warm cache with repeated reads
    let sqlCount = 0;
    const onQuery = () => {
      sqlCount++;
    };
    db.knex.on('query', onQuery);

    const firstRead = await articleRepo.find({ status: 'published' });
    const firstSql = sqlCount;
    const secondRead = await articleRepo.find({ status: 'published' });
    const secondSql = sqlCount;

    expect(firstRead).toHaveLength(75);
    expect(secondRead).toHaveLength(75);
    expect(firstSql).toBeGreaterThan(0);
    expect(secondSql).toBe(firstSql); // Served from query cache without hitting SQLite

    // Mutate: create a new published article -> must invalidate cached list
    const created = await articleRepo.create({
      author_id: author.id,
      title: 'Breaking News',
      status: 'published',
      views: 999,
    });

    const afterCreate = await articleRepo.find({ status: 'published' });
    expect(afterCreate).toHaveLength(76);

    // Mutate: soft-delete it -> must invalidate cached list again
    await articleRepo.delete(created.id);
    const afterDelete = await articleRepo.find({ status: 'published' });
    expect(afterDelete).toHaveLength(75);

    db.knex.off('query', onQuery);
  });

  it('2. isolates ambient transactions, rolls back cleanly on error, and defers onTransactionCommit', async () => {
    const authorRepo = db.getRepository('StressAuthor');
    const articleRepo = db.getRepository('StressArticle');

    const baseAuthor = await authorRepo.create({ name: 'Base', tier: 'free' });
    // Warm cache before transaction
    expect(await articleRepo.find({ author_id: baseAuthor.id })).toHaveLength(0);

    let commitHookCalls = 0;

    // Failing transaction must roll back all writes and skip commit hooks
    await expect(
      db.transaction(async () => {
        expect(hasAmbientTransaction()).toBe(true);
        onTransactionCommit(() => {
          commitHookCalls++;
        });

        for (let i = 0; i < 10; i++) {
          await articleRepo.create({
            author_id: baseAuthor.id,
            title: `Rollback-${i}`,
            status: 'published',
          });
        }

        throw new Error('simulated-tx-failure');
      })
    ).rejects.toThrow('simulated-tx-failure');

    expect(hasAmbientTransaction()).toBe(false);
    expect(commitHookCalls).toBe(0);
    expect(await articleRepo.find({ author_id: baseAuthor.id })).toHaveLength(0);

    // Successful transaction must commit atomically and fire onTransactionCommit
    await db.transaction(async () => {
      expect(hasAmbientTransaction()).toBe(true);
      onTransactionCommit(() => {
        commitHookCalls++;
      });

      for (let i = 0; i < 5; i++) {
        await articleRepo.create({
          author_id: baseAuthor.id,
          title: `Committed-${i}`,
          status: 'published',
        });
      }
    });

    expect(hasAmbientTransaction()).toBe(false);
    expect(commitHookCalls).toBe(1);
    expect(await articleRepo.find({ author_id: baseAuthor.id })).toHaveLength(5);
  });

  it('3. eager-loads 50 authors and 250 articles without N+1 queries', async () => {
    const authorRepo = db.getRepository('StressAuthor');
    const articleRepo = db.getRepository('StressArticle');

    const authors = [];
    for (let a = 0; a < 50; a++) {
      authors.push(await authorRepo.create({ name: `Author-${a}`, tier: a % 2 === 0 ? 'pro' : 'free' }));
    }

    for (const author of authors) {
      for (let j = 0; j < 5; j++) {
        await articleRepo.create({
          author_id: author.id,
          title: `${author.name}-Post-${j}`,
          status: 'published',
          views: j * 10,
        });
      }
    }

    let queries = 0;
    const counter = () => {
      queries++;
    };
    db.knex.on('query', counter);

    const articlesWithAuthor = await articleRepo.query().include('author').find();
    const belongsToQueries = queries;

    queries = 0;
    const authorsWithArticles = await authorRepo.query().include('articles').find();
    const hasManyQueries = queries;

    db.knex.off('query', counter);

    expect(articlesWithAuthor).toHaveLength(250);
    expect(belongsToQueries).toBeLessThanOrEqual(3);
    for (const art of articlesWithAuthor) {
      expect(art.author).toBeDefined();
      expect(art.author.id).toBe(art.author_id);
    }

    expect(authorsWithArticles).toHaveLength(50);
    expect(hasManyQueries).toBeLessThanOrEqual(3);
    for (const auth of authorsWithArticles) {
      expect(auth.articles).toHaveLength(5);
    }
  });

  it('4. enforces multi-tenant scopes, soft-delete lifecycle, and hidden field sanitization', async () => {
    const adminRepo = db.getRepository('StressScopedSecret');
    const tenants = ['t-alpha', 't-beta', 't-gamma', 't-delta'];

    const createdByTenant = new Map(tenants.map((t) => [t, []]));
    for (let i = 0; i < 100; i++) {
      const tenant = tenants[i % tenants.length];
      const rec = await adminRepo.create({
        tenant_id: tenant,
        label: `Key-${i}`,
        secret_token: `tok_${tenant}_${i}`,
      });
      createdByTenant.get(tenant).push(rec);
    }

    // Soft-delete 10 items from t-alpha
    const alphaRepo = db.getRepository('StressScopedSecret', { tenantId: 't-alpha' });
    const alphaItems = createdByTenant.get('t-alpha');
    for (let i = 0; i < 10; i++) {
      await alphaRepo.delete(alphaItems[i].id);
    }

    const activeAlpha = await alphaRepo.find();
    expect(activeAlpha).toHaveLength(15);
    for (const row of activeAlpha) {
      expect(row.tenant_id).toBe('t-alpha');
      const sanitized = omitHiddenColumns(row, ScopedSecret);
      expect(sanitized.secret_token).toBeUndefined();
      expect(sanitized.label).toBe(row.label);
    }

    // Cross-tenant isolation: t-alpha cannot read t-beta's ID
    const betaFirst = createdByTenant.get('t-beta')[0];
    expect(await alphaRepo.findById(betaFirst.id)).toBeNull();

    // Soft-delete inspection & restore
    const trashedAlpha = await alphaRepo.query().onlyTrashed().find();
    expect(trashedAlpha).toHaveLength(10);

    await alphaRepo.restore(alphaItems[0].id);
    expect(await alphaRepo.count()).toBe(16);

    await alphaRepo.forceDelete(alphaItems[1].id);
    const withTrashedAlpha = await alphaRepo.query().withTrashed().find();
    expect(withTrashedAlpha).toHaveLength(24);
  });

  it('5. paginates 300 records deterministically under concurrent burst queries', async () => {
    const authorRepo = db.getRepository('StressAuthor');
    const articleRepo = db.getRepository('StressArticle');

    const author = await authorRepo.create({ name: 'Pager', tier: 'pro' });
    for (let i = 1; i <= 300; i++) {
      await articleRepo.create({
        author_id: author.id,
        title: `PageItem-${String(i).padStart(3, '0')}`,
        status: 'published',
        views: i,
      });
    }

    const pageRequests = [];
    for (let page = 1; page <= 15; page++) {
      pageRequests.push(
        articleRepo
          .query()
          .where('status', 'published')
          .orderBy('id', 'asc')
          .paginate({ page, limit: 20 })
      );
    }

    // Add 15 concurrent filtered count/read queries in the same burst
    for (let k = 0; k < 15; k++) {
      pageRequests.push(articleRepo.query().where('views', '>', 200).count());
    }

    const results = await Promise.all(pageRequests);
    const pages = results.slice(0, 15);
    const counts = results.slice(15);

    const seenIds = new Set();
    for (const p of pages) {
      expect(p.data).toHaveLength(20);
      expect(p.total).toBe(300);
      expect(p.totalPages).toBe(15);
      for (const row of p.data) {
        seenIds.add(row.id);
      }
    }

    expect(seenIds.size).toBe(300);
    for (const c of counts) {
      expect(c).toBe(100);
    }
  });
});

/**
 * REST resources plugin integration tests
 */

const path = require('path');
const request = require('supertest');
const { createApp } = require('../../src/server');
const { createDatabase } = require('../../core/orm');
const restResourcePlugin = require('../../plugins/rest-resources');
const {
  initModels,
  createTestSchema,
  dropTestSchema,
  seedTestData,
} = require('../fixtures/orm/models');

const FIXTURES_PAGES = path.join(__dirname, '..', 'fixtures', 'pages');
const FIXTURES_VIEWS = path.join(__dirname, '..', 'fixtures', 'views');

describe('REST resources plugin', () => {
  let db;

  beforeAll(async () => {
    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      models: './tests/fixtures/models-empty',
    });

    const { Company, User, Post } = initModels(true);
    db.registerModel(Company);
    db.registerModel(User);
    db.registerModel(Post);

    await createTestSchema(db.knex);
    await seedTestData(db.knex);
  });

  afterAll(async () => {
    await dropTestSchema(db.knex);
    await db.destroy();
  });

  it('does not mount companies when rest.enabled is false and no whitelist', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      db,
      plugins: [restResourcePlugin({ path: '/api/rest' })],
    });

    await request(app).get('/api/rest/companies').expect(404);
  });

  it('lists users and omits hidden columns', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      db,
      plugins: [restResourcePlugin({ path: '/api/rest' })],
    });

    const res = await request(app).get('/api/rest/users').expect(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    const row = res.body.data.find((r) => r.id === 1);
    expect(row).toBeDefined();
    expect(row.metadata).toBeUndefined();
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(1);
  });

  it('eager-loads allowed include=company on user', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      db,
      plugins: [restResourcePlugin({ path: '/api/rest' })],
    });

    const res = await request(app).get('/api/rest/users/1?include=company').expect(200);
    expect(res.body.data.company).toBeDefined();
    expect(res.body.data.company.name).toBe('Acme Corp');
  });

  it('ignores disallowed include (posts) on user', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      db,
      plugins: [restResourcePlugin({ path: '/api/rest' })],
    });

    const res = await request(app).get('/api/rest/users/1?include=posts').expect(200);
    expect(res.body.data.posts).toBeUndefined();
  });

  it('eager-loads include=author on post and strips nested hidden on author', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      db,
      plugins: [restResourcePlugin({ path: '/api/rest' })],
    });

    const res = await request(app).get('/api/rest/posts/1?include=author').expect(200);
    expect(res.body.data.author).toBeDefined();
    expect(res.body.data.author.email).toBe('john@acme.com');
    expect(res.body.data.author.metadata).toBeUndefined();
  });

  it('exposes model with rest.enabled false when listed in plugin models whitelist', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      db,
      plugins: [
        restResourcePlugin({
          path: '/api/rest',
          models: ['Company', 'User', 'Post'],
        }),
      ],
    });

    const res = await request(app).get('/api/rest/companies').expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.some((c) => c.slug === 'acme-corp')).toBe(true);
  });

  it('creates, updates, and soft-deletes a user', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      db,
      plugins: [restResourcePlugin({ path: '/api/rest' })],
    });

    const email = `rest-${Date.now()}@example.com`;
    const created = await request(app)
      .post('/api/rest/users')
      .send({ email, name: 'REST User', status: 'active', company_id: 1 })
      .expect(201);

    const id = created.body.data.id;
    expect(id).toBeDefined();
    expect(created.body.data.email).toBe(email);

    const patched = await request(app)
      .patch(`/api/rest/users/${id}`)
      .send({ name: 'REST User Updated' })
      .expect(200);
    expect(patched.body.data.name).toBe('REST User Updated');

    await request(app).delete(`/api/rest/users/${id}`).expect(200);

    const gone = await request(app).get(`/api/rest/users/${id}`).expect(404);
    expect(gone.body.error).toBeDefined();
  });

  it('filters records by table columns in query parameters', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      db,
      plugins: [restResourcePlugin({ path: '/api/rest' })],
    });

    const res = await request(app).get('/api/rest/users?status=inactive').expect(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].status).toBe('inactive');
    expect(res.body.data[0].email).toBe('bob@tech.com');
  });

  it('supports pagination with page and perPage limits', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      db,
      plugins: [restResourcePlugin({ path: '/api/rest' })],
    });

    const res = await request(app).get('/api/rest/users?page=1&perPage=2').expect(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.perPage).toBe(2);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(3);
    expect(res.body.pagination.totalPages).toBeGreaterThanOrEqual(2);
  });

  it('supports sorting by column name and order direction', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      db,
      plugins: [restResourcePlugin({ path: '/api/rest' })],
    });

    const ascRes = await request(app).get('/api/rest/users?sort=name&order=asc').expect(200);
    const namesAsc = ascRes.body.data.map((u) => u.name);
    const sortedAsc = [...namesAsc].sort((a, b) => a.localeCompare(b));
    expect(namesAsc).toEqual(sortedAsc);

    const descRes = await request(app).get('/api/rest/users?sort=name&order=desc').expect(200);
    const namesDesc = descRes.body.data.map((u) => u.name);
    const sortedDesc = [...namesAsc].reverse();
    expect(namesDesc).toEqual(sortedDesc);
  });

  it('handles soft-delete scopes with trashed=only and trashed=include', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      db,
      plugins: [restResourcePlugin({ path: '/api/rest' })],
    });

    const onlyTrashed = await request(app).get('/api/rest/users?trashed=only').expect(200);
    expect(onlyTrashed.body.data.length).toBeGreaterThanOrEqual(1);
    expect(onlyTrashed.body.data.some((u) => u.email === 'deleted@test.com')).toBe(true);

    const withTrashed = await request(app).get('/api/rest/users?trashed=include').expect(200);
    expect(withTrashed.body.data.some((u) => u.email === 'deleted@test.com')).toBe(true);
    expect(withTrashed.body.data.some((u) => u.email === 'john@acme.com')).toBe(true);
  });

  it('executes custom plugin middleware chain', async () => {
    const authGuard = (req, res, next) => {
      if (req.headers['x-api-key'] === 'secret-token') {
        return next();
      }
      res.status(401).json({ error: 'Unauthorized request' });
    };

    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      db,
      plugins: [
        restResourcePlugin({
          path: '/api/rest',
          middleware: [authGuard],
        }),
      ],
    });

    await request(app).get('/api/rest/users').expect(401);

    const res = await request(app)
      .get('/api/rest/users')
      .set('x-api-key', 'secret-token')
      .expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('returns 404 for non-existent records on get, patch, delete', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      db,
      plugins: [restResourcePlugin({ path: '/api/rest' })],
    });

    await request(app).get('/api/rest/users/999999').expect(404);
    await request(app).patch('/api/rest/users/999999').send({ name: 'Ghost' }).expect(404);
    await request(app).delete('/api/rest/users/999999').expect(404);
  });

  it('respects excludeModels and filter options', async () => {
    const { app } = createApp({
      pagesDir: FIXTURES_PAGES,
      viewsDir: FIXTURES_VIEWS,
      db,
      plugins: [
        restResourcePlugin({
          path: '/api/rest',
          excludeModels: ['Post'],
          filter: (model) => model.name !== 'Company',
        }),
      ],
    });

    await request(app).get('/api/rest/posts').expect(404);
    await request(app).get('/api/rest/companies').expect(404);
    await request(app).get('/api/rest/users').expect(200);
  });
});


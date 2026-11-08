/**
 * @vitest-environment node
 *
 * Smoke test for examples/fullstack-app — the application every benchmark runs against.
 * Guarantees the benchmark target stays functional (a broken route must never look "fast").
 */
const request = require('supertest');
const { createFullstackApp } = require('../../examples/fullstack-app/app');

describe('examples/fullstack-app smoke test', () => {
  let ctx;
  let token;
  let slug;

  beforeAll(async () => {
    ctx = await createFullstackApp({ seed: { users: 3, posts: 12, commentsPerPost: 2 }, logging: false });
    const login = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'secret-password' });
    expect(login.status).toBe(200);
    token = login.body.accessToken;
  });

  afterAll(async () => {
    if (ctx) await ctx.close();
  });

  it('renders SSR pages with loader + service data', async () => {
    const home = await request(ctx.app).get('/');
    expect(home.status).toBe(200);
    expect(home.text).toContain('Latest posts');
    expect(home.text).toMatch(/<strong>\d+<\/strong> published/);

    const about = await request(ctx.app).get('/about');
    expect(about.status).toBe(200);
    expect(about.text).toContain('Features covered');

    const list = await request(ctx.app).get('/posts?page=1&category=engineering');
    expect(list.status).toBe(200);
    expect(list.text).toContain('Posts in “engineering”');
  });

  it('serves the paginated JSON API with eager-loaded relations and hidden fields', async () => {
    const res = await request(ctx.app).get('/api/posts?perPage=3');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.data[0].author).toHaveProperty('name');
    expect(res.body.data[0].author).not.toHaveProperty('password');
    expect(res.body.data[0].category).toHaveProperty('slug');
    slug = res.body.data[0].slug;

    const detail = await request(ctx.app).get(`/api/posts/${slug}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.comments).toHaveLength(2);

    const page = await request(ctx.app).get(`/posts/${slug}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('2 comments');
  });

  it('returns 404 for unknown pages and posts', async () => {
    expect((await request(ctx.app).get('/nope')).status).toBe(404);
    expect((await request(ctx.app).get('/api/posts/missing-slug')).status).toBe(404);
  });

  it('protects writes with JWT and validates input', async () => {
    expect((await request(ctx.app).get('/api/me')).status).toBe(401);

    const me = await request(ctx.app).get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('admin@example.com');
    expect(me.body.user).not.toHaveProperty('password');

    const before = (await request(ctx.app).get('/api/stats')).body.data.posts;

    const created = await request(ctx.app)
      .post('/api/posts')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Smoke test post', body: 'Hello from the smoke test', categoryId: 1 });
    expect(created.status).toBe(201);
    expect(created.body.data.author_id).toBe(me.body.user.id);

    // post.create clears the memoized stats.overview cache
    const after = (await request(ctx.app).get('/api/stats')).body.data.posts;
    expect(after).toBe(before + 1);

    const invalid = await request(ctx.app)
      .post('/api/posts')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'x' });
    expect(invalid.status).toBe(400);

    const badCategory = await request(ctx.app)
      .post('/api/posts')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Valid title', body: 'b', categoryId: 9999 });
    expect(badCategory.status).toBe(422);
  });

  it('exposes platform endpoints (health, metrics, redirects)', async () => {
    expect((await request(ctx.app).get('/healthz')).status).toBe(200);
    expect((await request(ctx.app).get('/readyz')).status).toBe(200);
    const metrics = await request(ctx.app).get('/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.text).toContain('webspresso_http_requests_total');
    const redirect = await request(ctx.app).get('/blog');
    expect(redirect.status).toBe(301);
    expect(redirect.headers.location).toBe('/posts');
  });
});


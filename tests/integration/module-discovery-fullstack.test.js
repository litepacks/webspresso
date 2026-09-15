import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import { createApp } from '../../index';

describe('Module & File Discovery Fullstack Integration', () => {
  let app;
  const fixtureRoot = path.resolve(__dirname, '../fixtures/fullstack');

  beforeAll(() => {
    const serverInstance = createApp({
      rootDir: fixtureRoot,
      pages: { dir: 'src/pages' },
      api: { dir: 'src/api', prefix: '/api' },
      modules: { dir: 'src/modules' },
    });
    app = serverInstance.app;
  });

  it('should compile and list all discovered routes via app.routes.list()', () => {
    expect(app.routes).toBeDefined();
    const routeList = app.routes.list();

    const paths = routeList.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain('GET /');
    expect(paths).toContain('GET /about');
    expect(paths).toContain('GET /api/health');
    expect(paths).toContain('GET /auth/login');
    expect(paths).toContain('POST /api/auth/login');
    expect(paths).toContain('GET /api/auth/me');
  });

  it('should serve global pages (GET / and GET /about)', async () => {
    const resHome = await request(app).get('/');
    expect(resHome.status).toBe(200);
    expect(resHome.text).toContain('Welcome to Webspresso');

    const resAbout = await request(app).get('/about');
    expect(resAbout.status).toBe(200);
    expect(resAbout.text).toContain('About Us');
  });

  it('should serve global API endpoints (GET /api/health)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.uptime).toBeDefined();
  });

  it('should serve module pages (GET /auth/login)', async () => {
    const res = await request(app).get('/auth/login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Login Page');
  });

  it('should execute module API with Zod validation and service integration (POST /api/auth/login)', async () => {
    // Valid input
    const resSuccess = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'secretpassword' });

    expect(resSuccess.status).toBe(200);
    expect(resSuccess.body).toEqual({
      success: true,
      token: 'jwt_mock_token_123',
      email: 'user@example.com',
    });

    // Invalid input (short password, invalid email)
    const resFail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'invalid-email', password: '12' });

    expect(resFail.status).toBe(400);
    expect(resFail.body.error).toBe('Validation Error');
  });

  it('should enforce module-local middleware on protected routes (GET /api/auth/me)', async () => {
    // Without token -> 401
    const resUnauth = await request(app).get('/api/auth/me');
    expect(resUnauth.status).toBe(401);
    expect(resUnauth.body.error).toBe('Unauthorized');

    // With Bearer token -> 200
    const resAuth = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer valid_token');

    expect(resAuth.status).toBe(200);
    expect(resAuth.body.user).toEqual({
      id: 'usr_1',
      email: 'test@example.com',
    });
  });
});

/**
 * Auth System Integration Tests
 */

const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const {
  createAuth,
  quickAuth,
  hash,
  verify,
  setupAuthMiddleware,
  createRememberTokensTable,
  dropRememberTokensTable,
} = require('../../core/auth');
const { createDatabase, defineModel, clearRegistry, zdb } = require('../../core/orm');

describe('Auth Integration', () => {
  let db;
  let app;
  let auth;
  let UserRepo;
  let users = [];

  beforeAll(async () => {
    // Create in-memory database
    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      models: './tests/fixtures/models-empty',
    });

    // Create users table
    await db.knex.schema.createTable('users', (table) => {
      table.bigIncrements('id').primary();
      table.string('email', 255).unique().notNullable();
      table.string('password', 255).notNullable();
      table.string('name', 255);
      table.string('role').defaultTo('user');
      table.timestamp('email_verified_at').nullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
    });

    // Create remember_tokens table
    await createRememberTokensTable(db.knex);

    // Define User model
    clearRegistry();
    const UserSchema = zdb.schema({
      id: zdb.id(),
      email: zdb.string({ maxLength: 255 }),
      password: zdb.string({ maxLength: 255 }),
      name: zdb.string({ maxLength: 255, nullable: true }),
      role: zdb.string({ default: 'user' }),
      email_verified_at: zdb.timestamp({ nullable: true }),
      created_at: zdb.timestamp({ auto: 'create' }),
      updated_at: zdb.timestamp({ auto: 'update' }),
    });

    const UserModel = defineModel({
      name: 'User',
      table: 'users',
      schema: UserSchema,
      scopes: { timestamps: true },
    });

    db.registerModel(UserModel);
    UserRepo = db.getRepository('User');

    // Create test users
    const hashedPassword = await hash('password123');
    users.push(await UserRepo.create({
      email: 'user@test.com',
      password: hashedPassword,
      name: 'Test User',
      role: 'user',
    }));
    users.push(await UserRepo.create({
      email: 'admin@test.com',
      password: hashedPassword,
      name: 'Admin User',
      role: 'admin',
      email_verified_at: new Date(),
    }));
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(() => {
    // Create fresh Express app for each test
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Create auth instance
    auth = createAuth({
      findUserById: async (id) => await UserRepo.findById(id),
      findUserByCredentials: async (email, password) => {
        const user = await UserRepo.findOne({ email });
        if (user && await verify(password, user.password)) {
          return user;
        }
        return null;
      },
      rememberTokens: {
        create: async (userId, token, expiresAt) => {
          await db.knex('remember_tokens').insert({
            user_id: userId,
            token,
            expires_at: expiresAt,
            created_at: new Date(),
          });
        },
        find: async (token) => {
          return await db.knex('remember_tokens').where({ token }).first();
        },
        delete: async (token) => {
          await db.knex('remember_tokens').where({ token }).delete();
        },
        deleteAllForUser: async (userId) => {
          await db.knex('remember_tokens').where({ user_id: userId }).delete();
        },
      },
      session: {
        secret: 'test-secret-key-for-integration-tests',
        resave: false,
        saveUninitialized: false,
      },
    });

    // Setup auth middleware
    setupAuthMiddleware(app, auth);
  });

  describe('Authentication Flow', () => {
    beforeEach(() => {
      // Login route
      app.post('/login', async (req, res) => {
        const { email, password, remember } = req.body;
        const user = await req.auth.attempt(email, password, { remember: remember === 'on' });
        
        if (user) {
          return res.json({ success: true, user: { id: user.id, email: user.email } });
        }
        
        return res.status(401).json({ success: false, error: 'Invalid credentials' });
      });

      // Logout route
      app.post('/logout', async (req, res) => {
        await req.auth.logout();
        res.json({ success: true });
      });

      // Protected route
      app.get('/dashboard', (req, res) => {
        if (!req.auth.check()) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        res.json({ user: req.user });
      });

      // User info route
      app.get('/me', (req, res) => {
        res.json({
          authenticated: req.auth.check(),
          guest: req.auth.guest(),
          user: req.auth.user(),
          userId: req.auth.id(),
        });
      });
    });

    it('should return guest status initially', async () => {
      const res = await request(app)
        .get('/me')
        .expect(200);

      expect(res.body.authenticated).toBe(false);
      expect(res.body.guest).toBe(true);
      expect(res.body.user).toBeNull();
      expect(res.body.userId).toBeNull();
    });

    it('should login with valid credentials', async () => {
      const res = await request(app)
        .post('/login')
        .send({ email: 'user@test.com', password: 'password123' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.user.email).toBe('user@test.com');
    });

    it('should reject invalid credentials', async () => {
      const res = await request(app)
        .post('/login')
        .send({ email: 'user@test.com', password: 'wrongpassword' })
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Invalid credentials');
    });

    it('should maintain session after login', async () => {
      const agent = request.agent(app);

      // Login
      await agent
        .post('/login')
        .send({ email: 'user@test.com', password: 'password123' })
        .expect(200);

      // Check authenticated
      const res = await agent.get('/me').expect(200);

      expect(res.body.authenticated).toBe(true);
      expect(res.body.guest).toBe(false);
      expect(res.body.user.email).toBe('user@test.com');
    });

    it('should logout and clear session', async () => {
      const agent = request.agent(app);

      // Login
      await agent
        .post('/login')
        .send({ email: 'user@test.com', password: 'password123' })
        .expect(200);

      // Logout
      await agent.post('/logout').expect(200);

      // Check guest
      const res = await agent.get('/me').expect(200);

      expect(res.body.authenticated).toBe(false);
      expect(res.body.guest).toBe(true);
    });

    it('should protect routes requiring auth', async () => {
      const res = await request(app)
        .get('/dashboard')
        .expect(401);

      expect(res.body.error).toBe('Unauthorized');
    });

    it('should allow authenticated users to access protected routes', async () => {
      const agent = request.agent(app);

      // Login
      await agent
        .post('/login')
        .send({ email: 'user@test.com', password: 'password123' })
        .expect(200);

      // Access dashboard
      const res = await agent.get('/dashboard').expect(200);

      expect(res.body.user.email).toBe('user@test.com');
    });
  });

  describe('Policy/Authorization', () => {
    beforeEach(() => {
      // Define policies
      auth.definePolicy('post', {
        view: () => true,
        edit: (user, post) => user?.id === post?.author_id || user?.role === 'admin',
        delete: (user) => user?.role === 'admin',
      });

      auth.defineGate('admin', (user) => user?.role === 'admin');

      // Routes
      app.post('/login', async (req, res) => {
        const user = await req.auth.attempt(req.body.email, req.body.password);
        if (user) {
          return res.json({ success: true });
        }
        return res.status(401).json({ error: 'Invalid credentials' });
      });

      app.get('/post/:id/check', (req, res) => {
        const post = { id: req.params.id, author_id: 1 }; // Mock post

        res.json({
          canView: req.auth.can('view', 'post', post),
          canEdit: req.auth.can('edit', 'post', post),
          canDelete: req.auth.can('delete', 'post'),
          isAdmin: req.auth.can('admin'),
        });
      });
    });

    it('should deny all actions for guest', async () => {
      const res = await request(app)
        .get('/post/1/check')
        .expect(200);

      expect(res.body.canView).toBe(true); // view is always true
      expect(res.body.canEdit).toBe(false);
      expect(res.body.canDelete).toBe(false);
      expect(res.body.isAdmin).toBe(false);
    });

    it('should allow owner to edit', async () => {
      const agent = request.agent(app);

      // Login as user (id: 1, which matches post.author_id)
      await agent
        .post('/login')
        .send({ email: 'user@test.com', password: 'password123' })
        .expect(200);

      const res = await agent.get('/post/1/check').expect(200);

      expect(res.body.canView).toBe(true);
      expect(res.body.canEdit).toBe(true); // Owner can edit
      expect(res.body.canDelete).toBe(false); // Only admin can delete
      expect(res.body.isAdmin).toBe(false);
    });

    it('should allow admin to do everything', async () => {
      const agent = request.agent(app);

      // Login as admin
      await agent
        .post('/login')
        .send({ email: 'admin@test.com', password: 'password123' })
        .expect(200);

      const res = await agent.get('/post/1/check').expect(200);

      expect(res.body.canView).toBe(true);
      expect(res.body.canEdit).toBe(true); // Admin can edit
      expect(res.body.canDelete).toBe(true); // Admin can delete
      expect(res.body.isAdmin).toBe(true);
    });
  });

  describe('Middleware', () => {
    beforeEach(() => {
      const { createAuthMiddleware } = require('../../core/auth');
      const middleware = createAuthMiddleware(auth);

      app.post('/login', async (req, res) => {
        const user = await req.auth.attempt(req.body.email, req.body.password);
        if (user) {
          return res.json({ success: true });
        }
        return res.status(401).json({ error: 'Invalid' });
      });

      // Protected API route
      app.get('/api/protected', middleware.requireAuth({ api: true }), (req, res) => {
        res.json({ data: 'secret' });
      });

      // Guest only route
      app.get('/guest-only', middleware.requireGuest({ redirectTo: '/home' }), (req, res) => {
        res.json({ message: 'Welcome guest' });
      });

      app.get('/home', (req, res) => {
        res.json({ message: 'Home page' });
      });
    });

    it('should return 401 JSON for API routes', async () => {
      const res = await request(app)
        .get('/api/protected')
        .expect(401);

      expect(res.body.error).toBe('Unauthorized');
    });

    it('should allow authenticated users to API routes', async () => {
      const agent = request.agent(app);

      await agent
        .post('/login')
        .send({ email: 'user@test.com', password: 'password123' })
        .expect(200);

      const res = await agent.get('/api/protected').expect(200);

      expect(res.body.data).toBe('secret');
    });

    it('should redirect authenticated users from guest routes', async () => {
      const agent = request.agent(app);

      await agent
        .post('/login')
        .send({ email: 'user@test.com', password: 'password123' })
        .expect(200);

      const res = await agent
        .get('/guest-only')
        .expect(302);

      expect(res.headers.location).toBe('/home');
    });

    it('should allow guests to guest routes', async () => {
      const res = await request(app)
        .get('/guest-only')
        .expect(200);

      expect(res.body.message).toBe('Welcome guest');
    });
  });

  describe('quickAuth Helper', () => {
    it('should create auth with ORM integration', async () => {
      const quickAuthInstance = quickAuth({
        db,
        userModel: 'User',
        identifierField: 'email',
        passwordField: 'password',
        session: { secret: 'quick-test-secret' },
        rememberMe: false,
      });

      expect(quickAuthInstance).toBeInstanceOf(require('../../core/auth').AuthManager);
    });
  });
});

const z = require('zod');
const knexLib = require('knex');
const { createDatabase } = require('../../core/orm');
const { defineModel, clearRegistry } = require('../../core/orm/model');
const { createAuthTokensTable, dropAuthTokensTable } = require('../../core/auth/tokens');
const { createServiceRegistry } = require('../../src/services');
const { createAuthServices } = require('../../src/services/builtins/auth');

describe('Built-in Auth Services (auth.*)', () => {
  let db;
  let knex;
  let services;

  beforeAll(async () => {
    clearRegistry();

    const userSchema = z.object({
      id: z.number().optional(),
      email: z.string().email(),
      password: z.string(),
      name: z.string().optional(),
      role: z.string().default('user'),
      active: z.boolean().default(true),
      email_verified_at: z.date().nullable().optional(),
    });

    defineModel({
      name: 'User',
      table: 'users',
      schema: userSchema,
    });

    db = createDatabase({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    knex = db.knex;

    await knex.schema.createTable('users', (table) => {
      table.increments('id').primary();
      table.string('email').notNullable().unique();
      table.string('password').notNullable();
      table.string('name');
      table.string('role').defaultTo('user');
      table.boolean('active').defaultTo(true);
      table.timestamp('email_verified_at').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });

    await createAuthTokensTable(knex);

    services = createServiceRegistry();
    const authMap = createAuthServices({ db });
    for (const [name, def] of Object.entries(authMap)) {
      services.register(name, def);
    }
  });

  afterAll(async () => {
    clearRegistry();
    await dropAuthTokensTable(knex);
    await knex.destroy();
  });

  describe('auth.register', () => {
    it('should register a new user with hashed password and return safe user object', async () => {
      const result = await services.call(
        'auth.register',
        { email: 'john@example.com', password: 'password123', name: 'John Doe' },
        { db }
      );

      expect(result.user).toBeDefined();
      expect(result.user.email).toBe('john@example.com');
      expect(result.user.name).toBe('John Doe');
      expect(result.user.password).toBeUndefined();

      const inDb = await knex('users').where({ email: 'john@example.com' }).first();
      expect(inDb).toBeDefined();
      expect(inDb.password).not.toBe('password123');
      expect(inDb.password.startsWith('$2')).toBe(true);
    });

    it('should throw ValidationError on duplicate email', async () => {
      await expect(
        services.call(
          'auth.register',
          { email: 'john@example.com', password: 'password123' },
          { db }
        )
      ).rejects.toThrow('already registered');
    });
  });

  describe('auth.login', () => {
    it('should authenticate user and set session when req exists', async () => {
      const mockReq = { session: { cookie: {} } };

      const result = await services.call(
        'auth.login',
        { email: 'john@example.com', password: 'password123', remember: true },
        { db, req: mockReq }
      );

      expect(result.user).toBeDefined();
      expect(result.user.email).toBe('john@example.com');
      expect(result.user.password).toBeUndefined();
      expect(mockReq.session.user).toEqual(result.user);
      expect(mockReq.session.cookie.maxAge).toBeGreaterThan(1000 * 60 * 60 * 24);
    });

    it('should reject invalid password or non-existent user with UnauthorizedError', async () => {
      await expect(
        services.call('auth.login', { email: 'john@example.com', password: 'wrongpassword' }, { db })
      ).rejects.toThrow('Invalid email or password');

      await expect(
        services.call('auth.login', { email: 'nobody@example.com', password: 'password123' }, { db })
      ).rejects.toThrow('Invalid email or password');
    });

    it('should reject deactivated accounts with UnauthorizedError', async () => {
      await knex('users').where({ email: 'john@example.com' }).update({ active: 0 });

      await expect(
        services.call('auth.login', { email: 'john@example.com', password: 'password123' }, { db })
      ).rejects.toThrow('Account is deactivated');

      await knex('users').where({ email: 'john@example.com' }).update({ active: 1 });
    });
  });

  describe('auth.request-password-reset & auth.reset-password', () => {
    let rawResetToken;

    it('should safely return sent: true even for non-existent emails without leaking account presence', async () => {
      const res = await services.call(
        'auth.request-password-reset',
        { email: 'ghost@example.com' },
        { db }
      );
      expect(res.sent).toBe(true);
      expect(res.rawToken).toBeNull();
    });

    it('should generate password reset token for valid user', async () => {
      const res = await services.call(
        'auth.request-password-reset',
        { email: 'john@example.com' },
        { db }
      );

      expect(res.sent).toBe(true);
      expect(res.rawToken).toBeDefined();
      expect(res.userId).toBeDefined();
      rawResetToken = res.rawToken;
    });

    it('should reset password with valid token and update hash', async () => {
      const res = await services.call(
        'auth.reset-password',
        { token: rawResetToken, password: 'newSecurePassword456' },
        { db }
      );

      expect(res.success).toBe(true);

      // Verify login with new password works
      const loginRes = await services.call(
        'auth.login',
        { email: 'john@example.com', password: 'newSecurePassword456' },
        { db }
      );
      expect(loginRes.user.email).toBe('john@example.com');

      // Re-using same token should fail
      await expect(
        services.call(
          'auth.reset-password',
          { token: rawResetToken, password: 'anotherPassword789' },
          { db }
        )
      ).rejects.toThrow('Invalid or expired');
    });
  });

  describe('auth.change-password', () => {
    it('should change password when user is authenticated in context and current password is valid', async () => {
      const user = await knex('users').where({ email: 'john@example.com' }).first();

      // Current password mismatch
      await expect(
        services.call(
          'auth.change-password',
          { currentPassword: 'badPassword', newPassword: 'brandNewPassword999' },
          { db, user }
        )
      ).rejects.toThrow('Current password does not match');

      // Valid current password
      const res = await services.call(
        'auth.change-password',
        { currentPassword: 'newSecurePassword456', newPassword: 'brandNewPassword999' },
        { db, user }
      );
      expect(res.success).toBe(true);

      // Verify login with new password
      const loginRes = await services.call(
        'auth.login',
        { email: 'john@example.com', password: 'brandNewPassword999' },
        { db }
      );
      expect(loginRes.user.id).toBe(user.id);
    });

    it('should reject unauthenticated caller', async () => {
      await expect(
        services.call(
          'auth.change-password',
          { currentPassword: 'any', newPassword: 'brandNewPassword999' },
          { db } // no user
        )
      ).rejects.toThrow();
    });
  });

  describe('auth.verify-email', () => {
    it('should verify email and update email_verified_at', async () => {
      const user = await knex('users').where({ email: 'john@example.com' }).first();
      expect(user.email_verified_at).toBeNull();

      const { createAuthToken, createKnexAuthTokensAdapter, TOKEN_TYPES } = require('../../core/auth/tokens');
      const adapter = createKnexAuthTokensAdapter(knex);
      const { rawToken } = await createAuthToken(adapter, TOKEN_TYPES.EMAIL_VERIFY, user.id, 60000);

      const res = await services.call('auth.verify-email', { token: rawToken }, { db });
      expect(res.success).toBe(true);
      expect(res.userId).toBe(user.id);

      const updated = await knex('users').where({ id: user.id }).first();
      expect(updated.email_verified_at).not.toBeNull();
    });
  });
});

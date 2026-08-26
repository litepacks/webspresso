/**
 * Built-in Auth Services
 * @module src/services/builtins/auth
 */

const { z } = require('zod');
const { hash, verify } = require('../../../core/auth/hash');
const {
  TOKEN_TYPES,
  createKnexAuthTokensAdapter,
  createAuthToken,
  verifyAuthToken,
  consumeAuthToken,
} = require('../../../core/auth/tokens');
const {
  ValidationError,
  UnauthorizedError,
  NotFoundError,
} = require('../../../core/errors');

/**
 * Create built-in auth services map
 * @param {Object} [options]
 * @param {string} [options.userModel='User'] - Name of user model
 * @param {Object} [options.fields] - Field name mappings
 * @returns {Record<string, Object>}
 */
function createAuthServices(options = {}) {
  const userModel = options.userModel || 'User';
  const fields = {
    email: 'email',
    password: 'password',
    name: 'name',
    role: 'role',
    active: 'active',
    emailVerifiedAt: 'email_verified_at',
    ...(options.fields || {}),
  };

  return {
    'auth.login': {
      schema: z.object({
        email: z.string().email(),
        password: z.string().min(1),
        remember: z.boolean().optional(),
      }),
      async handler(input, ctx) {
        const { email, password, remember } = input;
        const db = ctx.db;
        if (!db) {
          throw new Error('Database instance is required in context for auth.login');
        }

        const repo = db.getRepository(userModel);
        const user = await repo.findOne({ [fields.email]: email });

        if (!user) {
          throw new UnauthorizedError('Invalid email or password');
        }

        if (user[fields.active] === false || user[fields.active] === 0) {
          throw new UnauthorizedError('Account is deactivated');
        }

        const isValid = await verify(password, user[fields.password]);
        if (!isValid) {
          throw new UnauthorizedError('Invalid email or password');
        }

        // Exclude password from returned user object
        const { [fields.password]: _, ...safeUser } = user;

        // Attach to session if running inside HTTP request context
        if (ctx.req && ctx.req.session) {
          ctx.req.session.user = safeUser;
          if (remember && ctx.req.session.cookie) {
            // Extend session maxAge if remember is checked (30 days)
            ctx.req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
          }
        }

        return { user: safeUser };
      },
    },

    'auth.register': {
      schema: z.object({
        email: z.string().email(),
        password: z.string().min(8, 'Password must be at least 8 characters long'),
        name: z.string().optional(),
        role: z.string().optional(),
      }),
      transaction: true,
      async handler(input, ctx) {
        const { email, password, name, role } = input;
        const db = ctx.db;
        const trx = ctx.trx;
        if (!db) {
          throw new Error('Database instance is required in context for auth.register');
        }

        const repo = db.getRepository(userModel);
        const existing = await repo.findOne({ [fields.email]: email }, { trx });
        if (existing) {
          throw new ValidationError('Email is already registered', [
            { field: 'email', message: 'Email is already registered' },
          ]);
        }

        const hashedPassword = await hash(password);
        const userData = {
          [fields.email]: email,
          [fields.password]: hashedPassword,
        };

        if (name !== undefined) userData[fields.name] = name;
        if (role !== undefined) userData[fields.role] = role;

        const user = await repo.create(userData, { trx });
        const { [fields.password]: _, ...safeUser } = user;

        return { user: safeUser };
      },
    },

    'auth.request-password-reset': {
      schema: z.object({
        email: z.string().email(),
        ttlMs: z.number().positive().default(60 * 60 * 1000), // Default 1 hour
      }),
      async handler(input, ctx) {
        const { email, ttlMs } = input;
        const db = ctx.db;
        if (!db) {
          throw new Error('Database instance is required in context for auth.request-password-reset');
        }

        const repo = db.getRepository(userModel);
        const user = await repo.findOne({ [fields.email]: email });

        // Safe timing-attack resistant behavior: do not leak if account exists
        if (!user) {
          return { sent: true, userId: null, rawToken: null };
        }

        const adapter = createKnexAuthTokensAdapter(db.knex || db);
        const { rawToken, expiresAt } = await createAuthToken(
          adapter,
          TOKEN_TYPES.PASSWORD_RESET,
          user.id,
          ttlMs
        );

        return {
          sent: true,
          userId: user.id,
          rawToken,
          expiresAt,
        };
      },
    },

    'auth.reset-password': {
      schema: z.object({
        token: z.string().min(1, 'Reset token is required'),
        password: z.string().min(8, 'Password must be at least 8 characters long'),
      }),
      transaction: true,
      async handler(input, ctx) {
        const { token, password } = input;
        const db = ctx.db;
        const trx = ctx.trx;
        if (!db) {
          throw new Error('Database instance is required in context for auth.reset-password');
        }

        const adapter = createKnexAuthTokensAdapter(trx || db.knex || db);
        const verified = await verifyAuthToken(adapter, TOKEN_TYPES.PASSWORD_RESET, token);

        if (!verified) {
          throw new ValidationError('Invalid or expired password reset token', [
            { field: 'token', message: 'Token is invalid or has expired' },
          ]);
        }

        const hashedPassword = await hash(password);
        const repo = db.getRepository(userModel);
        await repo.update(verified.userId, { [fields.password]: hashedPassword }, { trx });

        await consumeAuthToken(adapter, verified.tokenHash);

        return { success: true, userId: verified.userId };
      },
    },

    'auth.change-password': {
      schema: z.object({
        currentPassword: z.string().min(1, 'Current password is required'),
        newPassword: z.string().min(8, 'New password must be at least 8 characters long'),
      }),
      auth: true, // Requires user in context
      transaction: true,
      async handler(input, ctx) {
        const { currentPassword, newPassword } = input;
        const db = ctx.db;
        const trx = ctx.trx;
        const currentUser = ctx.user || (ctx.auth && ctx.auth.user) || (ctx.req && ctx.req.session && ctx.req.session.user);

        if (!currentUser || !currentUser.id) {
          throw new UnauthorizedError('User authentication required');
        }

        const repo = db.getRepository(userModel);
        const user = await repo.findById(currentUser.id, { trx });

        if (!user) {
          throw new NotFoundError('User not found');
        }

        const isCurrentValid = await verify(currentPassword, user[fields.password]);
        if (!isCurrentValid) {
          throw new ValidationError('Current password does not match', [
            { field: 'currentPassword', message: 'Current password does not match' },
          ]);
        }

        const hashedNewPassword = await hash(newPassword);
        await repo.update(currentUser.id, { [fields.password]: hashedNewPassword }, { trx });

        return { success: true };
      },
    },

    'auth.verify-email': {
      schema: z.object({
        token: z.string().min(1, 'Verification token is required'),
      }),
      transaction: true,
      async handler(input, ctx) {
        const { token } = input;
        const db = ctx.db;
        const trx = ctx.trx;
        if (!db) {
          throw new Error('Database instance is required in context for auth.verify-email');
        }

        const adapter = createKnexAuthTokensAdapter(trx || db.knex || db);
        const verified = await verifyAuthToken(adapter, TOKEN_TYPES.EMAIL_VERIFY, token);

        if (!verified) {
          throw new ValidationError('Invalid or expired verification token', [
            { field: 'token', message: 'Verification token is invalid or has expired' },
          ]);
        }

        const repo = db.getRepository(userModel);
        await repo.update(
          verified.userId,
          { [fields.emailVerifiedAt]: new Date() },
          { trx }
        );

        await consumeAuthToken(adapter, verified.tokenHash);

        return { success: true, userId: verified.userId };
      },
    },
  };
}

module.exports = {
  createAuthServices,
};

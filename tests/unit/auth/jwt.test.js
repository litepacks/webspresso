import { describe, it, expect, vi } from 'vitest';
import {
  signJwt,
  verifyJwt,
  decodeJwt,
  createAuth,
  quickAuth,
  createAuthMiddleware,
} from '../../../core/auth';

describe('Zero-Dependency JWT Core Module', () => {
  const secret = 'super-secret-test-key-12345';

  describe('signJwt & verifyJwt', () => {
    it('should sign and verify valid JWT token', () => {
      const payload = { userId: 42, role: 'admin' };
      const token = signJwt(payload, secret, { expiresIn: '1h' });

      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3);

      const verified = verifyJwt(token, secret);
      expect(verified.userId).toBe(42);
      expect(verified.role).toBe('admin');
      expect(verified.iat).toBeTypeOf('number');
      expect(verified.exp).toBeTypeOf('number');
    });

    it('should throw error when secret is invalid or signature is tampered', () => {
      const token = signJwt({ id: 1 }, secret);
      expect(() => verifyJwt(token, 'wrong-secret')).toThrow('Invalid JWT signature');

      const parts = token.split('.');
      const tamperedToken = `${parts[0]}.${parts[1]}.tamperedSignature`;
      expect(() => verifyJwt(tamperedToken, secret)).toThrow('Invalid JWT signature');
    });

    it('should throw error when token is expired', async () => {
      // 0 second expiration
      const token = signJwt({ id: 1 }, secret, { expiresIn: 0 });
      // Small sleep to ensure exp < nowSec
      await new Promise((r) => setTimeout(r, 1100));

      expect(() => verifyJwt(token, secret)).toThrow('JWT token has expired');
    });

    it('should decode JWT without verifying signature', () => {
      const token = signJwt({ username: 'john' }, secret);
      const decoded = decodeJwt(token);

      expect(decoded.header.alg).toBe('HS256');
      expect(decoded.payload.username).toBe('john');
    });
  });

  describe('AuthManager JWT Methods', () => {
    const mockDb = {
      getRepository: () => ({
        findById: async (id) => ({ id, name: 'Test User', email: 'test@example.com' }),
        findOne: async () => null,
      }),
    };

    it('should support JWT generation via AuthManager', () => {
      const auth = createAuth({
        findUserById: async (id) => ({ id, email: 'test@example.com' }),
        findUserByCredentials: async () => null,
        session: { secret },
        jwt: { secret, expiresIn: '2h' },
      });

      const token = auth.createJwt({ userId: 100 });
      const decoded = auth.verifyJwt(token);
      expect(decoded.userId).toBe(100);

      const userToken = auth.generateUserToken({ id: 99, email: 'user99@example.com' });
      const userDecoded = auth.verifyJwt(userToken);
      expect(userDecoded.id).toBe(99);
      expect(userDecoded.email).toBe('user99@example.com');
    });

    it('should work seamlessly with quickAuth({ jwt: true })', () => {
      const auth = quickAuth({
        db: mockDb,
        session: { secret },
        jwt: true,
      });

      expect(auth.jwt).not.toBeNull();
      expect(auth.jwt.enabled).toBe(true);

      const token = auth.generateUserToken({ id: 50, email: 'test50@example.com' });
      const decoded = auth.verifyJwt(token);
      expect(decoded.id).toBe(50);
    });

    it('should generate and refresh access token using refresh token', async () => {
      const auth = createAuth({
        findUserById: async (id) => ({ id, email: 'test@example.com' }),
        findUserByCredentials: async () => null,
        session: { secret },
        jwt: { secret, expiresIn: '15m', refreshExpiresIn: '7d' },
      });

      const user = { id: 88, email: 'user88@example.com' };
      const refreshToken = auth.generateRefreshToken(user);

      // Refresh token cannot be used as an access token
      expect(() => auth.verifyJwt(refreshToken)).toThrow('Refresh token cannot be used as an access token');

      // Refresh access token
      const result = await auth.refreshAccessToken(refreshToken);
      expect(result.accessToken).toBeTypeOf('string');
      expect(result.refreshToken).toBeTypeOf('string');
      expect(result.user.id).toBe(88);

      const accessDecoded = auth.verifyJwt(result.accessToken);
      expect(accessDecoded.id).toBe(88);
      expect(accessDecoded.type).toBe('access');
    });
  });

  describe('Middleware JWT Bearer Integration', () => {
    const mockUser = { id: 7, name: 'Alice', email: 'alice@example.com' };
    const authManager = createAuth({
      findUserById: async (id) => (id === 7 ? mockUser : null),
      findUserByCredentials: async () => null,
      session: { secret },
      jwt: { secret, expiresIn: '1h' },
    });

    const middleware = createAuthMiddleware(authManager);

    it('should authenticate request with valid Bearer token', async () => {
      const token = authManager.generateUserToken(mockUser);
      const req = {
        headers: {
          authorization: `Bearer ${token}`,
        },
      };
      const res = {};
      const next = vi.fn();

      await middleware.authenticate(req, res, next);

      expect(req.user).toEqual(mockUser);
      expect(req.token).toBe(token);
      expect(next).toHaveBeenCalled();
    });

    it('should enforce requireJwt guard middleware', async () => {
      const token = authManager.generateUserToken(mockUser);

      // Valid token request
      const reqValid = { headers: { authorization: `Bearer ${token}` } };
      const resValid = {};
      const nextValid = vi.fn();

      await middleware.requireJwt()(reqValid, resValid, nextValid);
      expect(reqValid.user).toEqual(mockUser);
      expect(nextValid).toHaveBeenCalled();

      // Missing token request
      const reqInvalid = { headers: {} };
      const resInvalid = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const nextInvalid = vi.fn();

      await middleware.requireJwt()(reqInvalid, resInvalid, nextInvalid);
      expect(resInvalid.status).toHaveBeenCalledWith(401);
      expect(resInvalid.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Unauthorized' })
      );
      expect(nextInvalid).not.toHaveBeenCalled();
    });

    it('should prioritize Bearer token over Session in authenticate middleware', async () => {
      const jwtUser = { id: 7, name: 'Alice', email: 'alice@example.com' };
      const token = authManager.generateUserToken(jwtUser);

      const req = {
        headers: { authorization: `Bearer ${token}` },
        session: { userId: 99 }, // Different session user
      };
      const res = {};
      const next = vi.fn();

      await middleware.authenticate(req, res, next);
      expect(req.user.id).toBe(7); // JWT user takes precedence
      expect(next).toHaveBeenCalled();
    });

    it('should fallback to Session when no Bearer header is present', async () => {
      const sessionUser = { id: 7, name: 'Alice', email: 'alice@example.com' };
      const req = {
        headers: {},
        session: { userId: 7 },
      };
      const res = {};
      const next = vi.fn();

      await middleware.authenticate(req, res, next);
      expect(req.user).toEqual(sessionUser);
      expect(next).toHaveBeenCalled();
    });

    it('should reject refresh token in requireJwt middleware', async () => {
      const refreshToken = authManager.generateRefreshToken(mockUser);
      const req = { headers: { authorization: `Bearer ${refreshToken}` } };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await middleware.requireJwt()(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
          message: 'Refresh token cannot be used as an access token',
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should parse jwt string middleware via parseMiddlewareString', () => {
      const jwtFn = middleware.parseMiddlewareString('jwt');
      expect(typeof jwtFn).toBe('function');
    });
  });
});

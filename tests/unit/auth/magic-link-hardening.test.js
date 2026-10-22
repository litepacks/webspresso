const {
  createMagicLinkRequestHandler,
  createMagicLinkVerifyMiddleware,
} = require('../../../core/auth/magic-link');

describe('Magic Link Security Hardening & Anti-Enumeration', () => {
  describe('createMagicLinkRequestHandler Anti-Enumeration', () => {
    let mockAuthManager;

    beforeEach(() => {
      mockAuthManager = {
        config: {
          magicLink: {
            tokenTtlMs: 15 * 60 * 1000,
          },
        },
        requestMagicLink: vi.fn(),
      };
    });

    it('returns identical shape with homogenized expiresAt for non-existent users', async () => {
      // Non-existent user returns userFound: false without expiresAt from manager
      mockAuthManager.requestMagicLink.mockResolvedValue({
        sent: true,
        userFound: false,
      });

      const handler = createMagicLinkRequestHandler(mockAuthManager);
      const req = { body: { email: 'nonexistent@example.com' } };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalled();
      const payload = res.json.mock.calls[0][0];

      expect(payload.ok).toBe(true);
      expect(payload.message).toBe('If the account exists, a magic link has been sent.');
      // Crucial: expiresAt MUST be present to prevent user enumeration
      expect(payload.expiresAt).toBeDefined();
      expect(new Date(payload.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('returns 404 when hideUserNotFound: false is explicitly configured and user is missing', async () => {
      mockAuthManager.requestMagicLink.mockResolvedValue({
        sent: false,
        userFound: false,
      });

      const handler = createMagicLinkRequestHandler(mockAuthManager, { hideUserNotFound: false });
      const req = { body: { email: 'ghost@example.com' } };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    });

    it('rejects whitespace-only identifier with 400', async () => {
      const handler = createMagicLinkRequestHandler(mockAuthManager);
      const req = { body: { email: '   ' } };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Email or identifier is required' });
      expect(mockAuthManager.requestMagicLink).not.toHaveBeenCalled();
    });

    it('trims valid email before passing to authManager', async () => {
      mockAuthManager.requestMagicLink.mockResolvedValue({
        sent: true,
        userFound: true,
        expiresAt: new Date(Date.now() + 60000),
      });

      const handler = createMagicLinkRequestHandler(mockAuthManager);
      const req = { body: { email: '   user@example.com   ' } };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await handler(req, res);

      expect(mockAuthManager.requestMagicLink).toHaveBeenCalledWith('user@example.com', {});
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('createMagicLinkVerifyMiddleware Parameter Pollution & Sanitization', () => {
    let mockAuthManager;

    beforeEach(() => {
      mockAuthManager = {
        verifyMagicLink: vi.fn(),
      };
    });

    it('safely handles array parameter pollution by taking first token', async () => {
      const user = { id: 10, email: 'polluted@example.com' };
      mockAuthManager.verifyMagicLink.mockResolvedValue({ user });

      const middleware = createMagicLinkVerifyMiddleware(mockAuthManager);
      const req = {
        query: { token: ['token-primary', 'token-injected'] },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await middleware(req, res);

      expect(mockAuthManager.verifyMagicLink).toHaveBeenCalledWith('token-primary', { markEmailVerified: true });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ ok: true, user });
    });

    it('trims token and rejects whitespace-only token', async () => {
      const middleware = createMagicLinkVerifyMiddleware(mockAuthManager);
      const req = {
        query: { token: '   ' },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await middleware(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Missing magic link token' });
      expect(mockAuthManager.verifyMagicLink).not.toHaveBeenCalled();
    });
  });
});

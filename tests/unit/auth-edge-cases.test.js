const { createAuth } = require('../../core/auth');

describe('Auth Edge Cases & Session Isolation', () => {
  let auth;

  beforeEach(() => {
    auth = createAuth({
      findUserById: async (id) => (id === 1 ? { id: 1, email: 'user@example.com' } : null),
      findUserByCredentials: async (email, pass) =>
        email === 'user@example.com' && pass === 'secret' ? { id: 1, email } : null,
      session: {
        secret: 'test-secret-must-be-long-enough-32-chars',
      },
      jwt: {
        secret: 'test-jwt-secret-must-be-long-enough',
      },
    });
  });

  it('should handle login() and logout() gracefully when req.session is undefined', async () => {
    const mockReq = {
      user: null,
      // req.session is undefined (e.g. JWT-only or stateless API)
    };
    const mockRes = {};

    const reqAuth = auth.createRequestAuth(mockReq, mockRes);

    const user = { id: 1, email: 'user@example.com' };
    await expect(reqAuth.login(user)).resolves.not.toThrow();

    expect(mockReq.user).toBe(user);
    expect(reqAuth.check()).toBe(true);

    await expect(reqAuth.logout()).resolves.not.toThrow();
    expect(mockReq.user).toBeNull();
    expect(reqAuth.check()).toBe(false);
  });

  it('should handle malformed and invalid tokens in verifyJwt safely', () => {
    expect(() => auth.verifyJwt('not-a-real-jwt-token')).toThrow();
    expect(() => auth.verifyJwt('')).toThrow();
    expect(() => auth.verifyJwt(null)).toThrow();
  });

  it('should generate and verify valid JWT tokens correctly', () => {
    const user = { id: 1, email: 'user@example.com', role: 'member' };
    const token = auth.generateUserToken(user, { expiresIn: 3600 });
    expect(typeof token).toBe('string');

    const payload = auth.verifyJwt(token);
    expect(payload.id).toBe(1);
    expect(payload.email).toBe('user@example.com');
    expect(payload.role).toBe('member');
  });
});

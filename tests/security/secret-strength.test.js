/**
 * Secret Strength Security Tests
 */
const { AuthManager } = require('../../core/auth/manager');

// AuthManager requires user lookup functions; these tests only exercise secret validation
const userLookups = {
  findUserById: async () => null,
  findUserByCredentials: async () => null,
};

describe('Secret Strength Validation in Production', () => {
  const originalEnv = process.env.NODE_ENV;

  it('throws an error in production if session secret is too short (< 32 chars)', () => {
    process.env.NODE_ENV = 'production';
    try {
      const auth = new AuthManager({
        ...userLookups,
        session: { secret: 'short-secret' },
      });
      expect(() => auth.getSessionConfig()).toThrow(/Production requires at least 32 high-entropy characters/);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('throws an error in production if session secret contains a weak dictionary word', () => {
    process.env.NODE_ENV = 'production';
    try {
      const auth = new AuthManager({
        ...userLookups,
        session: { secret: 'password12345678901234567890123456' },
      });
      expect(() => auth.getSessionConfig()).toThrow(/Production requires at least 32 high-entropy characters/);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('accepts strong >= 32 character high-entropy secret in production', () => {
    process.env.NODE_ENV = 'production';
    try {
      const strongSecret = '9f8e7d6c5b4a3928170e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c';
      const auth = new AuthManager({
        ...userLookups,
        session: { secret: strongSecret },
      });
      const config = auth.getSessionConfig();
      expect(config.secret).toBe(strongSecret);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('throws an error in production if JWT secret is weak default', () => {
    process.env.NODE_ENV = 'production';
    const originalJwtSecret = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      expect(() => {
        new AuthManager({
          ...userLookups,
          jwt: { secret: 'changeme123' },
        });
      }).toThrow(/Production requires at least 32 high-entropy characters/);
    } finally {
      if (originalJwtSecret) process.env.JWT_SECRET = originalJwtSecret;
      process.env.NODE_ENV = originalEnv;
    }
  });
});

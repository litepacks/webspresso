const { signJwt, verifyJwt, base64UrlEncode } = require('../../core/auth/jwt');

describe('Security: JWT Implementation & Signature Verification', () => {
  const SECRET = 'ultra-secure-random-jwt-secret-key-32-chars-long';

  it('should reject tokens with algorithm none or unsupported algorithms', () => {
    // Craft token with alg: none
    const header = base64UrlEncode(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const payload = base64UrlEncode(JSON.stringify({ id: 1, name: 'Admin' }));
    const unsignedToken = `${header}.${payload}.`;

    expect(() => verifyJwt(unsignedToken, SECRET)).toThrow(/Unsupported algorithm/i);

    // Craft token with alg: RS256
    const rsHeader = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const rsToken = `${rsHeader}.${payload}.fakeSignature`;
    expect(() => verifyJwt(rsToken, SECRET)).toThrow(/Unsupported algorithm/i);
  });

  it('should reject tampered payload or signature', () => {
    const token = signJwt({ id: 42, role: 'user' }, SECRET);
    const parts = token.split('.');

    // Tamper payload to escalate role to admin
    const tamperedPayload = base64UrlEncode(JSON.stringify({ id: 42, role: 'admin' }));
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    expect(() => verifyJwt(tamperedToken, SECRET)).toThrow(/Invalid JWT signature/i);

    // Tamper signature
    const badSigToken = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -4)}abcd`;
    expect(() => verifyJwt(badSigToken, SECRET)).toThrow(/Invalid JWT signature/i);
  });

  it('should reject expired tokens', () => {
    // Generate token expired 10 seconds ago
    const token = signJwt({ id: 42 }, SECRET, { expiresIn: -10 });
    expect(() => verifyJwt(token, SECRET)).toThrow(/expired/i);
  });

  it('should verify issuer and audience when configured', () => {
    const token = signJwt({ id: 42 }, SECRET, { issuer: 'auth.webspresso.com', audience: 'webspresso-app' });

    // Valid
    const verified = verifyJwt(token, SECRET, { issuer: 'auth.webspresso.com', audience: 'webspresso-app' });
    expect(verified.id).toBe(42);

    // Mismatched issuer
    expect(() => verifyJwt(token, SECRET, { issuer: 'evil.issuer.com' })).toThrow(/Invalid JWT issuer/i);

    // Mismatched audience
    expect(() => verifyJwt(token, SECRET, { audience: 'evil-audience' })).toThrow(/Invalid JWT audience/i);
  });
});

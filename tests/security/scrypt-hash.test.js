/**
 * Scrypt Password Hashing Security & Functional Tests
 * Verifies zero-dependency scrypt implementation and bcrypt interoperability
 */

const {
  hashScrypt,
  verifyScrypt,
  hash,
  verify,
  needsRehash,
  DEFAULT_SCRYPT_OPTIONS,
} = require('../../core/auth/hash');

describe('Scrypt Password Hashing', () => {
  it('should export DEFAULT_SCRYPT_OPTIONS', () => {
    expect(DEFAULT_SCRYPT_OPTIONS).toBeDefined();
    expect(DEFAULT_SCRYPT_OPTIONS.blockSize).toBe(8);
    expect(DEFAULT_SCRYPT_OPTIONS.parallelization).toBe(1);
    expect(DEFAULT_SCRYPT_OPTIONS.keylen).toBe(64);
  });

  describe('hashScrypt()', () => {
    it('should generate a standardized scrypt hash string', async () => {
      const password = 'mySuperSecurePassword123!';
      const hashed = await hashScrypt(password, { cost: 1024 });

      expect(hashed).toBeDefined();
      expect(typeof hashed).toBe('string');
      expect(hashed.startsWith('$scrypt$N=1024,r=8,p=1$')).toBe(true);

      const parts = hashed.split('$');
      // format: ['', 'scrypt', 'N=1024,r=8,p=1', '<salt>', '<hash>']
      expect(parts.length).toBe(5);
      expect(parts[1]).toBe('scrypt');
      expect(parts[2]).toBe('N=1024,r=8,p=1');
      expect(parts[3].length).toBe(32); // 16 bytes salt = 32 hex chars
      expect(parts[4].length).toBe(128); // 64 bytes key = 128 hex chars
    });

    it('should generate different salts and hashes for the same password', async () => {
      const password = 'samePassword';
      const hash1 = await hashScrypt(password, { cost: 1024 });
      const hash2 = await hashScrypt(password, { cost: 1024 });

      expect(hash1).not.toBe(hash2);
    });

    it('should reject invalid or non-string passwords', async () => {
      await expect(hashScrypt('')).rejects.toThrow('Password must be a non-empty string');
      await expect(hashScrypt(null)).rejects.toThrow('Password must be a non-empty string');
      await expect(hashScrypt(12345)).rejects.toThrow('Password must be a non-empty string');
    });
  });

  describe('verifyScrypt()', () => {
    it('should return true for correct password', async () => {
      const password = 'correctHorseBatteryStaple';
      const hashed = await hashScrypt(password, { cost: 1024 });

      const isValid = await verifyScrypt(password, hashed);
      expect(isValid).toBe(true);
    });

    it('should return false for incorrect password', async () => {
      const password = 'correctHorseBatteryStaple';
      const hashed = await hashScrypt(password, { cost: 1024 });

      const isValid = await verifyScrypt('wrongPassword', hashed);
      expect(isValid).toBe(false);
    });

    it('should return false for malformed hash strings or empty inputs', async () => {
      expect(await verifyScrypt('', '$scrypt$N=1024,r=8,p=1$1234$5678')).toBe(false);
      expect(await verifyScrypt('password', '')).toBe(false);
      expect(await verifyScrypt('password', 'not-a-valid-hash')).toBe(false);
      expect(await verifyScrypt('password', '$scrypt$invalid')).toBe(false);
      expect(await verifyScrypt(null, null)).toBe(false);
    });
  });

  describe('Unified hash() & verify() interoperability', () => {
    it('should allow explicitly requesting scrypt via algorithm option', async () => {
      const password = 'explicitScryptPassword';
      const hashed = await hash(password, { algorithm: 'scrypt', cost: 1024 });

      expect(hashed.startsWith('$scrypt$')).toBe(true);

      const isValid = await verify(password, hashed);
      expect(isValid).toBe(true);

      const isInvalid = await verify('wrong', hashed);
      expect(isInvalid).toBe(false);
    });

    it('should verify both bcrypt and scrypt hashes transparently', async () => {
      const password = 'multiAlgorithmPassword';

      // Bcrypt hash
      const bcryptHash = await hash(password, 4);
      expect(bcryptHash.startsWith('$2')).toBe(true);

      // Scrypt hash
      const scryptHash = await hash(password, { algorithm: 'scrypt', cost: 1024 });
      expect(scryptHash.startsWith('$scrypt$')).toBe(true);

      expect(await verify(password, bcryptHash)).toBe(true);
      expect(await verify(password, scryptHash)).toBe(true);
      expect(await verify('bad', bcryptHash)).toBe(false);
      expect(await verify('bad', scryptHash)).toBe(false);
    });
  });

  describe('needsRehash()', () => {
    it('should return false for scrypt hash when N matches desired cost', async () => {
      const hashed = await hashScrypt('password', { cost: 2048 });
      expect(needsRehash(hashed, { cost: 2048 })).toBe(false);
      expect(needsRehash(hashed, { cost: 1024 })).toBe(false);
    });

    it('should return true for scrypt hash when N is lower than desired cost', async () => {
      const hashed = await hashScrypt('password', { cost: 1024 });
      expect(needsRehash(hashed, { cost: 2048 })).toBe(true);
    });

    it('should return true when migrating bcrypt hash to scrypt', async () => {
      const bcryptHash = await hash('password', 4);
      expect(needsRehash(bcryptHash, { algorithm: 'scrypt' })).toBe(true);
    });

    it('should return true for null or empty hash', () => {
      expect(needsRehash('')).toBe(true);
      expect(needsRehash(null)).toBe(true);
      expect(needsRehash(undefined)).toBe(true);
    });
  });
});

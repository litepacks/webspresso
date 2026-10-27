const crypto = require('crypto');
const util = require('util');
const { sha256, randomToken } = require('../utils/crypto');

const scryptAsync = util.promisify(crypto.scrypt);

let bcrypt = null;
let bcryptChecked = false;
function getBcrypt() {
  if (!bcryptChecked) {
    bcryptChecked = true;
    try {
      bcrypt = require('bcrypt');
    } catch {
      bcrypt = null;
    }
  }
  return bcrypt;
}

/**
 * Default bcrypt cost factor
 * Higher = more secure but slower
 */
const DEFAULT_ROUNDS = process.env.NODE_ENV === 'test' ? 1 : 12;

/**
 * Default scrypt parameters (OWASP recommended)
 * In test environments, lower cost is used for test execution speed
 */
const DEFAULT_SCRYPT_OPTIONS = {
  cost: process.env.NODE_ENV === 'test' ? 1024 : 16384, // N
  blockSize: 8, // r
  parallelization: 1, // p
  keylen: 64,
  maxmem: 32 * 1024 * 1024, // 32MB
};

/**
 * Hash a password using native crypto.scrypt (zero external dependencies)
 * @param {string} password - Plain text password
 * @param {Object} [options] - Scrypt options
 * @param {number} [options.cost=16384] - CPU/memory cost parameter (N)
 * @param {number} [options.blockSize=8] - Block size parameter (r)
 * @param {number} [options.parallelization=1] - Parallelization parameter (p)
 * @param {number} [options.keylen=64] - Desired key length in bytes
 * @returns {Promise<string>} Standardized scrypt hash string
 */
async function hashScrypt(password, options = {}) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }

  const N = options.cost || options.N || DEFAULT_SCRYPT_OPTIONS.cost;
  const r = options.blockSize || options.r || DEFAULT_SCRYPT_OPTIONS.blockSize;
  const p = options.parallelization || options.p || DEFAULT_SCRYPT_OPTIONS.parallelization;
  const keylen = options.keylen || DEFAULT_SCRYPT_OPTIONS.keylen;
  const maxmem = options.maxmem || Math.max(DEFAULT_SCRYPT_OPTIONS.maxmem, 128 * N * r * 2);

  const salt = options.salt ? Buffer.from(options.salt) : crypto.randomBytes(16);
  const derivedKey = await scryptAsync(password, salt, keylen, { N, r, p, maxmem });

  return `$scrypt$N=${N},r=${r},p=${p}$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

/**
 * Verify a password against an scrypt hash
 * @param {string} password - Plain text password
 * @param {string} hashedPassword - Standardized scrypt hash string
 * @returns {Promise<boolean>} True if password matches
 */
async function verifyScrypt(password, hashedPassword) {
  if (!password || !hashedPassword || typeof password !== 'string' || typeof hashedPassword !== 'string') {
    return false;
  }

  const match = hashedPassword.match(/^\$scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([0-9a-fA-F]+)\$([0-9a-fA-F]+)$/);
  if (!match) {
    return false;
  }

  const N = parseInt(match[1], 10);
  const r = parseInt(match[2], 10);
  const p = parseInt(match[3], 10);
  const salt = Buffer.from(match[4], 'hex');
  const expectedKey = Buffer.from(match[5], 'hex');

  const maxmem = Math.max(DEFAULT_SCRYPT_OPTIONS.maxmem, 128 * N * r * 2);

  try {
    const derivedKey = await scryptAsync(password, salt, expectedKey.length, { N, r, p, maxmem });
    if (derivedKey.length !== expectedKey.length) {
      return false;
    }
    return crypto.timingSafeEqual(derivedKey, expectedKey);
  } catch {
    return false;
  }
}

/**
 * Hash a password using bcrypt (or native scrypt if bcrypt is unavailable or requested)
 * @param {string} password - Plain text password
 * @param {number|Object} [options=12] - Cost factor (rounds) or options object { algorithm: 'scrypt'|'bcrypt'|'auto', ... }
 * @returns {Promise<string>} Hashed password
 */
async function hash(password, options = DEFAULT_ROUNDS) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }

  let algorithm = 'auto';
  let rounds = DEFAULT_ROUNDS;
  let scryptOpts = {};

  if (typeof options === 'number') {
    rounds = options;
  } else if (options && typeof options === 'object') {
    algorithm = options.algorithm || 'auto';
    rounds = options.rounds || DEFAULT_ROUNDS;
    scryptOpts = options;
  }

  const b = getBcrypt();

  if (algorithm === 'scrypt' || (!b && algorithm === 'auto')) {
    return hashScrypt(password, scryptOpts);
  }

  if (!b) {
    throw new Error('bcrypt is required for bcrypt password hashing. Install it with: npm install bcrypt or use scrypt');
  }

  return b.hash(password, rounds);
}

/**
 * Verify a password against a hash (supports both bcrypt and native scrypt hashes)
 * @param {string} password - Plain text password to verify
 * @param {string} hashedPassword - Hashed password to compare against
 * @returns {Promise<boolean>} True if password matches
 */
async function verify(password, hashedPassword) {
  if (!password || !hashedPassword || typeof password !== 'string' || typeof hashedPassword !== 'string') {
    return false;
  }

  // Handle native scrypt hash format
  if (hashedPassword.startsWith('$scrypt$')) {
    return verifyScrypt(password, hashedPassword);
  }

  // Handle bcrypt hash formats ($2a$, $2b$, $2y$)
  if (hashedPassword.startsWith('$2')) {
    const b = getBcrypt();
    if (!b) {
      throw new Error('bcrypt is required to verify bcrypt hashes. Install it with: npm install bcrypt');
    }
    try {
      return await b.compare(password, hashedPassword);
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Check if a hash needs rehashing (e.g., cost factor changed or migrating to scrypt)
 * @param {string} hashedPassword - Hashed password to check
 * @param {number|Object} [options=12] - Desired cost factor (rounds) or options object
 * @returns {boolean} True if rehash is needed
 */
function needsRehash(hashedPassword, options = DEFAULT_ROUNDS) {
  if (!hashedPassword || typeof hashedPassword !== 'string') {
    return true;
  }

  let desiredAlgorithm = 'auto';
  let desiredRounds = DEFAULT_ROUNDS;
  let desiredN = DEFAULT_SCRYPT_OPTIONS.cost;

  if (typeof options === 'number') {
    desiredRounds = options;
  } else if (options && typeof options === 'object') {
    desiredAlgorithm = options.algorithm || 'auto';
    desiredRounds = options.rounds || DEFAULT_ROUNDS;
    desiredN = options.cost || options.N || DEFAULT_SCRYPT_OPTIONS.cost;
  }

  if (hashedPassword.startsWith('$scrypt$')) {
    if (desiredAlgorithm === 'bcrypt') return true;
    const match = hashedPassword.match(/^\$scrypt\$N=(\d+)/);
    if (!match) return true;
    const currentN = parseInt(match[1], 10);
    return currentN < desiredN;
  }

  if (hashedPassword.startsWith('$2')) {
    if (desiredAlgorithm === 'scrypt') return true;
    const b = getBcrypt();
    if (!b) return true;
    try {
      const hashRounds = b.getRounds(hashedPassword);
      return hashRounds < desiredRounds;
    } catch {
      return true;
    }
  }

  return true;
}

/**
 * Generate a secure random token
 * @param {number} [length=32] - Token length in bytes
 * @returns {string} Hex-encoded random token
 */
function generateToken(length = 32) {
  return randomToken(length, 'hex');
}

/**
 * Hash a high-entropy random lookup token for database storage (SHA-256).
 * Note: Used exclusively for 256-bit cryptographically secure random lookup tokens
 * (remember-me tokens, email verification tokens, password reset tokens), NOT user passwords.
 * User passwords must always be hashed using `hash()` (bcrypt or scrypt).
 *
 * // CodeQL [js/insufficient-password-hash] SHA-256 is intentionally used for 256-bit high-entropy random lookup token hashing, not user passwords.
 * @param {string} token - High-entropy random token
 * @returns {string} Hex-encoded SHA-256 digest
 */
function hashToken(token) {
  if (!token) return '';
  // CodeQL [js/insufficient-password-hash] False positive: token is a 256-bit random string, not a user password
  return sha256(String(token));
}

module.exports = {
  hash,
  verify,
  needsRehash,
  hashScrypt,
  verifyScrypt,
  DEFAULT_SCRYPT_OPTIONS,
  generateToken,
  hashToken,
  DEFAULT_ROUNDS,
};


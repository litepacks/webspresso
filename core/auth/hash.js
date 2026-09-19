/**
 * Webspresso Auth - Password Hashing
 * Bcrypt wrapper for secure password hashing
 * @module core/auth/hash
 */

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
 * Hash a password using bcrypt
 * @param {string} password - Plain text password
 * @param {number} [rounds=12] - Cost factor (rounds)
 * @returns {Promise<string>} Hashed password
 */
async function hash(password, rounds = DEFAULT_ROUNDS) {
  const b = getBcrypt();
  if (!b) {
    throw new Error('bcrypt is required for password hashing. Install it with: npm install bcrypt');
  }
  
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  
  return b.hash(password, rounds);
}

/**
 * Verify a password against a hash
 * @param {string} password - Plain text password to verify
 * @param {string} hashedPassword - Hashed password to compare against
 * @returns {Promise<boolean>} True if password matches
 */
async function verify(password, hashedPassword) {
  const b = getBcrypt();
  if (!b) {
    throw new Error('bcrypt is required for password verification. Install it with: npm install bcrypt');
  }
  
  if (!password || !hashedPassword) {
    return false;
  }
  
  try {
    return await b.compare(password, hashedPassword);
  } catch {
    return false;
  }
}

/**
 * Check if a hash needs rehashing (e.g., cost factor changed)
 * @param {string} hashedPassword - Hashed password to check
 * @param {number} [rounds=12] - Desired cost factor
 * @returns {boolean} True if rehash is needed
 */
function needsRehash(hashedPassword, rounds = DEFAULT_ROUNDS) {
  const b = getBcrypt();
  if (!b) {
    throw new Error('bcrypt is required. Install it with: npm install bcrypt');
  }
  
  if (!hashedPassword) {
    return true;
  }
  
  try {
    const hashRounds = b.getRounds(hashedPassword);
    return hashRounds < rounds;
  } catch {
    return true;
  }
}

/**
 * Generate a secure random token
 * @param {number} [length=32] - Token length in bytes
 * @returns {string} Hex-encoded random token
 */
function generateToken(length = 32) {
  const crypto = require('crypto');
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Hash a high-entropy random lookup token for database storage (SHA-256).
 * Note: Used exclusively for 256-bit cryptographically secure random lookup tokens
 * (remember-me tokens, email verification tokens, password reset tokens), NOT user passwords.
 * User passwords must always be hashed using `hash()` (bcrypt).
 *
 * // CodeQL [js/insufficient-password-hash] SHA-256 is intentionally used for 256-bit high-entropy random lookup token hashing, not user passwords.
 * @param {string} token - High-entropy random token
 * @returns {string} Hex-encoded SHA-256 digest
 */
function hashToken(token) {
  const crypto = require('crypto');
  // CodeQL [js/insufficient-password-hash] False positive: token is a 256-bit random string, not a user password
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

module.exports = {
  hash,
  verify,
  needsRehash,
  generateToken,
  hashToken,
  DEFAULT_ROUNDS,
};

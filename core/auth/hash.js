/**
 * Webspresso Auth - Password Hashing
 * Bcrypt wrapper for secure password hashing
 * @module core/auth/hash
 */

let bcrypt;
try {
  bcrypt = require('bcrypt');
} catch {
  // bcrypt is optional, will throw if used without installation
  bcrypt = null;
}

/**
 * Default bcrypt cost factor
 * Higher = more secure but slower
 */
const DEFAULT_ROUNDS = 12;

/**
 * Hash a password using bcrypt
 * @param {string} password - Plain text password
 * @param {number} [rounds=12] - Cost factor (rounds)
 * @returns {Promise<string>} Hashed password
 */
async function hash(password, rounds = DEFAULT_ROUNDS) {
  if (!bcrypt) {
    throw new Error('bcrypt is required for password hashing. Install it with: npm install bcrypt');
  }
  
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  
  return bcrypt.hash(password, rounds);
}

/**
 * Verify a password against a hash
 * @param {string} password - Plain text password to verify
 * @param {string} hashedPassword - Hashed password to compare against
 * @returns {Promise<boolean>} True if password matches
 */
async function verify(password, hashedPassword) {
  if (!bcrypt) {
    throw new Error('bcrypt is required for password verification. Install it with: npm install bcrypt');
  }
  
  if (!password || !hashedPassword) {
    return false;
  }
  
  try {
    return await bcrypt.compare(password, hashedPassword);
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
  if (!bcrypt) {
    throw new Error('bcrypt is required. Install it with: npm install bcrypt');
  }
  
  if (!hashedPassword) {
    return true;
  }
  
  try {
    const hashRounds = bcrypt.getRounds(hashedPassword);
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
 * Hash a token for storage (SHA-256)
 * Used for remember me tokens - stored hashed, compared hashed
 * @param {string} token - Plain token
 * @returns {string} Hashed token
 */
function hashToken(token) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  hash,
  verify,
  needsRehash,
  generateToken,
  hashToken,
  DEFAULT_ROUNDS,
};

/**
 * Webspresso Auth - Two-Factor Authentication (2FA / TOTP)
 * Zero-dependency RFC 6238 (TOTP), RFC 4226 (HOTP), and RFC 4648 (Base32) implementation
 * @module core/auth/totp
 */

const crypto = require('crypto');
const { generateQrSvg, generateQrDataUri, createQrMatrix } = require('./qrcode');

const RFC4648_BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encode buffer or string to RFC 4648 Base32
 * @param {Buffer|string} buffer
 * @param {Object} [options]
 * @param {boolean} [options.padding=false] - Whether to include '=' padding (default: false for authenticator apps)
 * @returns {string} Base32 uppercase string
 */
function base32Encode(buffer, options = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '', 'utf8');
  if (buf.length === 0) return '';
  const pad = options.padding === true;

  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      output += RFC4648_BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += RFC4648_BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  if (pad) {
    while (output.length % 8 !== 0) {
      output += '=';
    }
  }

  return output;
}

/**
 * Decode RFC 4648 Base32 string to Buffer
 * Tolerates lowercase, spaces, hyphens, and padding
 * @param {string} input
 * @returns {Buffer}
 */
function base32Decode(input) {
  if (typeof input !== 'string') {
    throw new TypeError('Base32 input must be a string');
  }

  let clean = input.toUpperCase().replace(/[\s-]/g, '');
  while (clean.endsWith('=')) {
    clean = clean.slice(0, -1);
  }
  if (clean.length === 0) return Buffer.alloc(0);

  let bits = 0;
  let value = 0;
  const bytes = [];

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const val = RFC4648_BASE32_ALPHABET.indexOf(char);
    if (val === -1) {
      throw new Error(`Invalid Base32 character: "${char}"`);
    }
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generate a random cryptographically secure TOTP secret key
 * @param {Object} [options]
 * @param {number} [options.length=20] - Number of random bytes (20 bytes = 160 bits per RFC recommendations)
 * @param {boolean} [options.padding=false] - Whether to pad the Base32 string
 * @returns {string} Base32 encoded secret
 */
function generateTotpSecret(options = {}) {
  const length = options.length || 20;
  const buffer = crypto.randomBytes(length);
  return base32Encode(buffer, options);
}

/**
 * Normalize secret to Buffer
 * @param {string|Buffer} secret
 * @param {string} [encoding='base32'] - 'base32', 'ascii', 'utf8', 'hex'
 * @returns {Buffer}
 */
function normalizeSecretBuffer(secret, encoding = 'base32') {
  if (Buffer.isBuffer(secret)) {
    return secret;
  }
  if (typeof secret !== 'string') {
    throw new TypeError('Secret must be a string or Buffer');
  }

  if (encoding === 'base32') {
    return base32Decode(secret);
  }
  return Buffer.from(secret, encoding);
}

/**
 * Normalize algorithm string to Node.js crypto algorithm name
 * @param {string} algorithm
 * @returns {string}
 */
function normalizeAlgorithm(algorithm = 'sha1') {
  const algo = String(algorithm).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (algo === 'sha1' || algo === 'sha256' || algo === 'sha512') {
    return algo;
  }
  return 'sha1';
}

/**
 * Generate HMAC-Based One-Time Password (HOTP, RFC 4226)
 * @param {string|Buffer} secret - Secret key (Base32 string or Buffer)
 * @param {number|BigInt} counter - 8-byte moving factor counter
 * @param {Object} [options]
 * @param {number} [options.digits=6] - Number of digits (typically 6, 7, or 8)
 * @param {string} [options.algorithm='sha1'] - 'sha1', 'sha256', 'sha512'
 * @param {string} [options.encoding='base32'] - Encoding of secret if string ('base32', 'ascii', etc.)
 * @returns {string} Numerical token padded with leading zeros
 */
function generateHotp(secret, counter, options = {}) {
  const key = normalizeSecretBuffer(secret, options.encoding);
  const digits = options.digits || 6;
  const algorithm = normalizeAlgorithm(options.algorithm);

  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter), 0);

  const hmac = crypto.createHmac(algorithm, key).update(counterBuf).digest();

  // Dynamic truncation (RFC 4226 Section 5.4)
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const token = (binary % 10 ** digits).toString().padStart(digits, '0');
  return token;
}

/**
 * Timing-safe token equality check
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeTokenCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;

  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify HOTP token against counter
 * @param {string} token - Submitted token
 * @param {string|Buffer} secret - Secret key
 * @param {number|BigInt} counter - Expected counter
 * @param {Object} [options]
 * @returns {boolean}
 */
function verifyHotp(token, secret, counter, options = {}) {
  if (typeof token !== 'string') return false;
  const cleanToken = token.trim();
  const digits = options.digits || cleanToken.length || 6;
  const expected = generateHotp(secret, counter, { ...options, digits });
  return timingSafeTokenCompare(cleanToken, expected);
}

/**
 * Generate Time-Based One-Time Password (TOTP, RFC 6238)
 * @param {string|Buffer} secret - Secret key (Base32 or Buffer)
 * @param {Object} [options]
 * @param {number|Date} [options.time=Date.now()] - Timestamp in ms, seconds, or Date
 * @param {number} [options.step=30] - Time step in seconds (default: 30)
 * @param {number} [options.epoch=0] - Epoch start in seconds (default: 0)
 * @param {number} [options.digits=6] - Number of digits (default: 6)
 * @param {string} [options.algorithm='sha1'] - 'sha1', 'sha256', 'sha512'
 * @param {string} [options.encoding='base32'] - Encoding of secret if string
 * @returns {string} Numerical token padded with leading zeros
 */
function generateTotp(secret, options = {}) {
  let timeSeconds;
  if (options.time instanceof Date) {
    timeSeconds = Math.floor(options.time.getTime() / 1000);
  } else if (typeof options.time === 'number') {
    // If value looks like milliseconds (> 10000000000), convert to seconds
    timeSeconds = options.time > 1e11 ? Math.floor(options.time / 1000) : Math.floor(options.time);
  } else {
    timeSeconds = Math.floor(Date.now() / 1000);
  }

  const step = options.step || 30;
  const epoch = options.epoch || 0;
  const counter = Math.floor((timeSeconds - epoch) / step);

  return generateHotp(secret, counter, options);
}

/**
 * Verify TOTP token with time-drift window support
 * @param {string} token - Submitted token
 * @param {string|Buffer} secret - Secret key
 * @param {Object} [options]
 * @param {number} [options.window=1] - Counter drift window (e.g. 1 checks counter-1, counter, counter+1)
 * @param {number|Date} [options.time=Date.now()] - Current timestamp
 * @param {number} [options.step=30] - Time step in seconds
 * @param {number} [options.digits=6] - Expected digits
 * @param {string} [options.algorithm='sha1'] - 'sha1', 'sha256', 'sha512'
 * @param {boolean} [options.detailed=false] - Return { valid: boolean, delta: number|null } instead of boolean
 * @returns {boolean|{ valid: boolean, delta: number|null }}
 */
function verifyTotp(token, secret, options = {}) {
  if (typeof token !== 'string') {
    return options.detailed ? { valid: false, delta: null } : false;
  }

  const cleanToken = token.trim();
  const digits = options.digits || cleanToken.length || 6;
  const step = options.step || 30;
  const epoch = options.epoch || 0;
  const windowSize = Math.max(0, options.window != null ? options.window : 1);

  let timeSeconds;
  if (options.time instanceof Date) {
    timeSeconds = Math.floor(options.time.getTime() / 1000);
  } else if (typeof options.time === 'number') {
    timeSeconds = options.time > 1e11 ? Math.floor(options.time / 1000) : Math.floor(options.time);
  } else {
    timeSeconds = Math.floor(Date.now() / 1000);
  }

  const currentCounter = Math.floor((timeSeconds - epoch) / step);

  for (let delta = -windowSize; delta <= windowSize; delta++) {
    const counter = currentCounter + delta;
    if (counter < 0) continue;

    const expected = generateHotp(secret, counter, { ...options, digits });
    if (timingSafeTokenCompare(cleanToken, expected)) {
      if (options.detailed) {
        return { valid: true, delta };
      }
      return true;
    }
  }

  if (options.detailed) {
    return { valid: false, delta: null };
  }
  return false;
}

/**
 * Generate standard Key URI for Google Authenticator / 1Password / Authy (otpauth://)
 * @param {Object} options
 * @param {string} options.secret - Base32 encoded secret
 * @param {string} [options.account] - User account identifier (e.g. 'alice@example.com')
 * @param {string} [options.issuer='Webspresso'] - Application or organization name
 * @param {string} [options.label] - Custom full label (overrides issuer:account)
 * @param {string} [options.algorithm='SHA1'] - Algorithm ('SHA1', 'SHA256', 'SHA512')
 * @param {number} [options.digits=6] - Number of digits
 * @param {number} [options.period=30] - Time period in seconds
 * @returns {string} otpauth URI string
 */
function generateTotpUri(options = {}) {
  const {
    secret,
    account,
    issuer = 'Webspresso',
    digits = 6,
    period = 30,
    algorithm = 'SHA1',
  } = options;

  if (!secret) {
    throw new Error('Secret is required to generate TOTP URI');
  }

  // Label: "Issuer:Account" or "Account"
  let label = options.label;
  if (!label) {
    const cleanAccount = account || 'user';
    label = issuer ? `${issuer}:${cleanAccount}` : cleanAccount;
  }

  const params = new URLSearchParams();
  params.set('secret', secret);
  if (issuer) params.set('issuer', issuer);
  if (algorithm && algorithm.toUpperCase() !== 'SHA1') {
    params.set('algorithm', algorithm.toUpperCase());
  }
  if (digits && digits !== 6) {
    params.set('digits', String(digits));
  }
  if (period && period !== 30) {
    params.set('period', String(period));
  }

  // otpauth://totp/LABEL?PARAMS
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

/**
 * Generate SVG string of the QR Code for a TOTP URI
 * @param {string|Object} uriOrOptions - URI string or options for generateTotpUri
 * @param {Object} [svgOptions] - QR SVG rendering options (size, margin, darkColor, lightColor)
 * @returns {string} SVG string
 */
function generateTotpQrSvg(uriOrOptions, svgOptions = {}) {
  const uri = typeof uriOrOptions === 'string' ? uriOrOptions : generateTotpUri(uriOrOptions);
  return generateQrSvg(uri, svgOptions);
}

/**
 * Generate Data URI of the QR Code SVG
 * @param {string|Object} uriOrOptions
 * @param {Object} [svgOptions]
 * @returns {string} data:image/svg+xml;utf8,...
 */
function generateTotpQrDataUri(uriOrOptions, svgOptions = {}) {
  const uri = typeof uriOrOptions === 'string' ? uriOrOptions : generateTotpUri(uriOrOptions);
  return generateQrDataUri(uri, svgOptions);
}

/**
 * Generate a set of random recovery / backup codes
 * E.g., 'a1b2-c3d4', '98f7-21a4'
 * @param {Object} [options]
 * @param {number} [options.count=8] - Number of codes to generate
 * @param {number} [options.length=10] - Characters per code (before hyphen)
 * @param {boolean} [options.hyphen=true] - Format with hyphen in middle
 * @returns {string[]} Array of plaintext recovery codes
 */
function generateRecoveryCodes(options = {}) {
  const count = options.count || 8;
  const length = options.length || 10;
  const hyphen = options.hyphen !== false;

  const codes = [];
  for (let i = 0; i < count; i++) {
    // Generate random hex characters
    const byteCount = Math.ceil(length / 2);
    let code = crypto.randomBytes(byteCount).toString('hex').slice(0, length);
    if (hyphen && code.length >= 6) {
      const mid = Math.floor(code.length / 2);
      code = `${code.slice(0, mid)}-${code.slice(mid)}`;
    }
    codes.push(code);
  }
  return codes;
}

/**
 * Hash a single recovery code for secure database storage
 * @param {string} code - Plaintext recovery code
 * @returns {string} SHA-256 hex hash
 */
function hashRecoveryCode(code) {
  if (typeof code !== 'string') {
    throw new TypeError('Recovery code must be a string');
  }
  const clean = code.toLowerCase().replace(/[\s-]/g, '');
  return crypto.createHash('sha256').update(clean, 'utf8').digest('hex');
}

/**
 * Verify a submitted recovery code against an array of hashed recovery codes
 * @param {string} code - Submitted plaintext recovery code
 * @param {string[]} hashedCodes - Array of hashed codes from database
 * @returns {{ valid: boolean, matchedIndex: number, remainingHashedCodes: string[] }}
 */
function verifyRecoveryCode(code, hashedCodes = []) {
  if (typeof code !== 'string' || !Array.isArray(hashedCodes) || hashedCodes.length === 0) {
    return { valid: false, matchedIndex: -1, remainingHashedCodes: hashedCodes || [] };
  }

  const targetHash = hashRecoveryCode(code);
  const targetBuf = Buffer.from(targetHash, 'hex');

  let matchedIndex = -1;
  for (let i = 0; i < hashedCodes.length; i++) {
    const candidateHash = hashedCodes[i];
    if (typeof candidateHash !== 'string' || candidateHash.length !== targetHash.length) {
      continue;
    }
    const candidateBuf = Buffer.from(candidateHash, 'hex');
    if (crypto.timingSafeEqual(targetBuf, candidateBuf)) {
      matchedIndex = i;
      break;
    }
  }

  if (matchedIndex === -1) {
    return { valid: false, matchedIndex: -1, remainingHashedCodes: [...hashedCodes] };
  }

  const remaining = hashedCodes.filter((_, idx) => idx !== matchedIndex);
  return {
    valid: true,
    matchedIndex,
    remainingHashedCodes: remaining,
  };
}

/**
 * Convenience all-in-one helper to initialize 2FA setup for a user
 * @param {Object} options
 * @param {Object|string} options.user - User object (with email or username) or user identifier string
 * @param {string} [options.issuer='Webspresso'] - App/Company name
 * @param {number} [options.recoveryCodeCount=8] - Number of backup codes
 * @param {Object} [options.qrOptions] - QR SVG options
 * @returns {{
 *   secret: string,
 *   uri: string,
 *   qrSvg: string,
 *   qrDataUri: string,
 *   recoveryCodes: string[],
 *   recoveryCodesHashed: string[]
 * }}
 */
function createTotpSetup(options = {}) {
  const secret = options.secret || generateTotpSecret(options);
  const user = options.user;
  const account = typeof user === 'string' ? user : (user?.email || user?.username || user?.id || 'user');
  const issuer = options.issuer || 'Webspresso';

  const uri = generateTotpUri({
    secret,
    account: String(account),
    issuer,
    ...options,
  });

  const qrSvg = generateTotpQrSvg(uri, options.qrOptions);
  const qrDataUri = generateTotpQrDataUri(uri, options.qrOptions);

  const recoveryCodes = generateRecoveryCodes({ count: options.recoveryCodeCount || 8 });
  const recoveryCodesHashed = recoveryCodes.map(hashRecoveryCode);

  return {
    secret,
    uri,
    qrSvg,
    qrDataUri,
    recoveryCodes,
    recoveryCodesHashed,
  };
}

module.exports = {
  // Base32
  base32Encode,
  base32Decode,

  // HOTP & TOTP Core
  generateTotpSecret,
  generateHotp,
  verifyHotp,
  generateTotp,
  verifyTotp,

  // URI & QR
  generateTotpUri,
  generateTotpQrSvg,
  generateTotpQrDataUri,

  // Recovery Codes
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyRecoveryCode,

  // All-in-one setup
  createTotpSetup,

  // QR primitives
  createQrMatrix,
  generateQrSvg,
  generateQrDataUri,
};

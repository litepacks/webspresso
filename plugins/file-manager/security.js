/**
 * File Manager Security Subsystem — Magic byte verification, dangerous extension blocking & SVG sanitization.
 * Zero external dependencies, ultra-high performance O(1) buffer checks.
 * @module plugins/file-manager/security
 */

const { SecurityError, ValidationError } = require('../../core/errors');

/**
 * Universal list of dangerous/executable extensions (lowercase without dot)
 */
const DANGEROUS_EXTENSIONS = new Set([
  // Scripts & Executables
  'php', 'phtml', 'php3', 'php4', 'php5', 'php7', 'php8', 'phps', 'phar',
  'exe', 'dll', 'so', 'dylib', 'bin', 'elf',
  'sh', 'bash', 'zsh', 'csh', 'ksh', 'fish', 'bat', 'cmd', 'ps1', 'psm1',
  'vbs', 'vbe', 'wsf', 'wsh', 'scr', 'cpl', 'msc', 'hta',
  'jar', 'war', 'ear', 'class',
  'jsp', 'jspx', 'jsw', 'jsv', 'jspf',
  'asp', 'aspx', 'axd', 'asx', 'ashx', 'asmx',
  'cgi', 'pl', 'pm', 'py', 'pyc', 'pyo', 'rb',
  // System & Config files
  'htaccess', 'htpasswd', 'ini', 'env', 'config', 'conf', 'passwd', 'shadow',
]);

/**
 * Known magic numbers table for high-speed signature verification.
 * Only validates when extension matches known binary format.
 */
const MAGIC_NUMBERS = {
  // JPEG / JPG
  jpg: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  jpeg: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,

  // PNG
  png: (buf) =>
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a,

  // GIF
  gif: (buf) =>
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61,

  // WebP: RIFF at 0..3 and WEBP at 8..11
  webp: (buf) =>
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50,

  // PDF: %PDF-
  pdf: (buf) =>
    buf.length >= 5 &&
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46 &&
    buf[4] === 0x2d,

  // ZIP (and DOCX/XLSX/PPTX)
  zip: (buf) =>
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07) &&
    (buf[3] === 0x04 || buf[3] === 0x06 || buf[3] === 0x08),
  docx: (buf) => MAGIC_NUMBERS.zip(buf),
  xlsx: (buf) => MAGIC_NUMBERS.zip(buf),
  pptx: (buf) => MAGIC_NUMBERS.zip(buf),

  // MP3: ID3 or frame sync 0xFFE / 0xFFF
  mp3: (buf) =>
    (buf.length >= 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) ||
    (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0),

  // MP4: ....ftyp at bytes 4..7
  mp4: (buf) =>
    buf.length >= 8 &&
    buf[4] === 0x66 &&
    buf[5] === 0x74 &&
    buf[6] === 0x79 &&
    buf[7] === 0x70,
};

/**
 * Validate that a filename contains no dangerous extensions or double-extension tricks.
 * @param {string} filename
 * @returns {string} Clean lowercase extension
 */
function validateSafeExtension(filename) {
  if (!filename || typeof filename !== 'string') {
    throw new ValidationError('Filename is required');
  }

  const cleanName = filename.toLowerCase().trim();
  const parts = cleanName.split('.').filter(Boolean);

  if (parts.length === 0) {
    throw new ValidationError('Filename must have a valid extension');
  }

  // Check all dotted segments against dangerous extensions to block double extensions (e.g. payload.php.jpg)
  for (let i = 1; i < parts.length; i++) {
    const segment = parts[i];
    if (DANGEROUS_EXTENSIONS.has(segment)) {
      throw new SecurityError(
        `Dangerous extension or double-extension detected: .${segment}`,
        400
      );
    }
  }

  const finalExt = parts[parts.length - 1];
  if (DANGEROUS_EXTENSIONS.has(finalExt)) {
    throw new SecurityError(`File type .${finalExt} is forbidden for upload`, 403);
  }

  return finalExt;
}

/**
 * Verify that the buffer's magic bytes match the claimed extension.
 * O(1) time complexity, minimal memory overhead.
 * @param {Buffer} buffer
 * @param {string} ext
 * @returns {boolean}
 */
function validateMagicBytes(buffer, ext) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new ValidationError('Valid buffer is required for magic byte check');
  }

  const cleanExt = (ext || '').replace(/^\./, '').toLowerCase();
  const validator = MAGIC_NUMBERS[cleanExt];

  if (validator) {
    const isValid = validator(buffer);
    if (!isValid) {
      throw new SecurityError(
        `File signature mismatch: file content does not match expected .${cleanExt} format`,
        400
      );
    }
  }

  return true;
}

/**
 * Sanitize SVG content against Stored XSS attacks.
 * Strips <script>, <foreignObject>, <iframe>, <embed>, <object> and on* event handlers.
 * @param {Buffer|string} content
 * @returns {Buffer} Sanitized SVG buffer
 */
function sanitizeSvgContent(content) {
  const str = Buffer.isBuffer(content) ? content.toString('utf8') : String(content);

  // Quick check: if no dangerous keywords, return original buffer directly for maximum speed
  if (!/<(script|foreignobject|iframe|embed|object|meta|link|style)/i.test(str) &&
      !/\s+on[a-z]+\s*=/i.test(str) &&
      !/javascript:/i.test(str) &&
      !/data:text\/html/i.test(str)) {
    return Buffer.isBuffer(content) ? content : Buffer.from(str, 'utf8');
  }

  let sanitized = str
    // Remove script tags and content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gi, '')
    // Remove dangerous containers
    .replace(/<foreignObject\b[^<]*(?:(?!<\/foreignObject>)<[^<]*)*<\/foreignObject\s*>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe\s*>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object\s*>/gi, '')
    // Remove inline event handlers (onload, onclick, onerror, onmouseover, etc.)
    .replace(/\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Remove javascript: and data:text/html URIs in href and xlink:href
    .replace(/(?:href|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, 'href=""')
    .replace(/(?:href|xlink:href)\s*=\s*(?:"\s*data:text\/html[^"]*"|'\s*data:text\/html[^']*')/gi, 'href=""');

  return Buffer.from(sanitized, 'utf8');
}

module.exports = {
  DANGEROUS_EXTENSIONS,
  MAGIC_NUMBERS,
  validateSafeExtension,
  validateMagicBytes,
  sanitizeSvgContent,
};

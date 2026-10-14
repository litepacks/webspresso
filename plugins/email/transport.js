/**
 * Nodemailer transport resolution
 * @module plugins/email/transport
 */

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch {
  nodemailer = null;
}

/**
 * Build SMTP config from env vars
 * @returns {Object|null}
 */
function smtpFromEnv() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;

  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  const config = { host, port, secure };
  if (user && pass) {
    config.auth = { user, pass };
  }
  return config;
}

const { resolveTransport, MemoryTransport, ConsoleTransport, FileTransport } = require('../../core/mail/transports');

/**
 * @param {Object} options
 * @param {Object} [options.transport] - Pre-built nodemailer or custom transport
 * @param {string} [options.backend] - 'memory' | 'console' | 'file' | 'smtp'
 * @param {Object} [options.smtp] - SMTP options
 * @returns {Object} transport
 */
function createTransport(options = {}) {
  if (options.transport) {
    return options.transport;
  }

  const backend = options.backend || options.type;
  if (backend === 'memory' || options.memory === true) {
    return new MemoryTransport(options);
  }
  if (backend === 'console' || options.console === true) {
    return new ConsoleTransport(options);
  }
  if (backend === 'file' || options.fileDir) {
    return new FileTransport({ dir: options.fileDir || options.dir });
  }

  const smtp = options.smtp || smtpFromEnv();
  if (smtp) {
    if (!nodemailer) {
      throw new Error('nodemailer is required. Install it with: npm install nodemailer');
    }
    return nodemailer.createTransport(smtp);
  }

  // In test or development without SMTP, gracefully fallback to MemoryTransport
  if (process.env.NODE_ENV === 'test' || options.fallbackToMemory !== false) {
    return new MemoryTransport(options);
  }

  throw new Error(
    'Email transport not configured. Pass transport/smtp options or set SMTP_HOST env variable.'
  );
}


/**
 * Default from address
 * @param {Object} [defaults={}]
 * @returns {string|undefined}
 */
function resolveDefaultFrom(defaults = {}) {
  return defaults.from || process.env.MAIL_FROM || undefined;
}

module.exports = {
  createTransport,
  smtpFromEnv,
  resolveDefaultFrom,
};

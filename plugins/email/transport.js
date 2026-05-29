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

/**
 * @param {Object} options
 * @param {Object} [options.transport] - Pre-built nodemailer transport
 * @param {Object} [options.smtp] - SMTP options
 * @returns {Object} nodemailer transport
 */
function createTransport(options = {}) {
  if (!nodemailer) {
    throw new Error('nodemailer is required. Install it with: npm install nodemailer');
  }

  if (options.transport) {
    return options.transport;
  }

  const smtp = options.smtp || smtpFromEnv();
  if (!smtp) {
    throw new Error(
      'Email transport not configured. Pass transport/smtp options or set SMTP_HOST env variable.'
    );
  }

  return nodemailer.createTransport(smtp);
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

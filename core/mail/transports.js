/**
 * Mail Transports / Backends (Django Email Backends & AdonisJS-inspired)
 * @module core/mail/transports
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch {
  nodemailer = null;
}

/**
 * In-Memory Transport for testing & local development dev inbox (Django MemoryEmailBackend)
 */
class MemoryTransport {
  constructor(options = {}) {
    this.name = 'memory';
    this.outbox = [];
    this.options = options;
  }

  /**
   * Send mail into in-memory outbox array
   * @param {Object} mailOptions
   * @returns {Promise<Object>}
   */
  async sendMail(mailOptions) {
    const id = mailOptions.messageId || `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const sentEntry = {
      id,
      messageId: id,
      ...mailOptions,
      sentAt: new Date(),
    };

    this.outbox.push(sentEntry);

    return {
      messageId: id,
      accepted: Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to],
      rejected: [],
      response: '250 OK: Message stored in MemoryTransport outbox',
    };
  }

  getOutbox() {
    return [...this.outbox];
  }

  clearOutbox() {
    this.outbox = [];
  }

  lastMessage() {
    return this.outbox.length > 0 ? this.outbox[this.outbox.length - 1] : null;
  }

  findById(id) {
    return this.outbox.find((msg) => msg.id === id || msg.messageId === id) || null;
  }

  async verify() {
    return true;
  }
}

/**
 * Console Transport for development inspection (Django ConsoleEmailBackend)
 */
class ConsoleTransport {
  constructor(options = {}) {
    this.name = 'console';
    this.logger = options.logger || console;
  }

  async sendMail(mailOptions) {
    const id = `console_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const border = '='.repeat(60);

    this.logger.log(`\n${border}`);
    this.logger.log(`📧 [EMAIL SENT VIA CONSOLE TRANSPORT] (${id})`);
    this.logger.log(`From:    ${mailOptions.from || '(default)'}`);
    this.logger.log(`To:      ${Array.isArray(mailOptions.to) ? mailOptions.to.join(', ') : mailOptions.to}`);
    if (mailOptions.cc) this.logger.log(`Cc:      ${mailOptions.cc}`);
    if (mailOptions.bcc) this.logger.log(`Bcc:     ${mailOptions.bcc}`);
    this.logger.log(`Subject: ${mailOptions.subject}`);
    this.logger.log(`Date:    ${new Date().toISOString()}`);
    this.logger.log('-'.repeat(60));
    if (mailOptions.text) {
      this.logger.log('--- Plain Text ---');
      this.logger.log(mailOptions.text);
    }
    if (mailOptions.html) {
      this.logger.log('--- HTML Content ---');
      this.logger.log(mailOptions.html.length > 300 ? `${mailOptions.html.slice(0, 300)}... (truncated)` : mailOptions.html);
    }
    this.logger.log(`${border}\n`);

    return {
      messageId: id,
      accepted: Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to],
      rejected: [],
      response: '250 OK: Logged to console',
    };
  }

  async verify() {
    return true;
  }
}

/**
 * File-based Transport for offline inspection (Django FileEmailBackend)
 */
class FileTransport {
  constructor(options = {}) {
    this.name = 'file';
    this.dir = options.dir || path.join(process.cwd(), '.cache', 'emails');
    if (!fs.existsSync(this.dir)) {
      try {
        fs.mkdirSync(this.dir, { recursive: true });
      } catch {
        // ignore
      }
    }
  }

  async sendMail(mailOptions) {
    const id = `mail_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const filePath = path.join(this.dir, `${id}.json`);
    const data = {
      id,
      ...mailOptions,
      sentAt: new Date().toISOString(),
    };

    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[FileTransport] Failed to write file:', err.message);
    }

    return {
      messageId: id,
      accepted: Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to],
      rejected: [],
      filePath,
      response: `250 OK: Written to ${filePath}`,
    };
  }

  async verify() {
    return fs.existsSync(this.dir);
  }
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
 * Factory to resolve or create appropriate email transport
 * @param {Object} [options={}]
 * @returns {Object} Transport instance with sendMail()
 */
function resolveTransport(options = {}) {
  // 1. Direct custom transport provided
  if (options.transport) {
    return options.transport;
  }

  const backend = options.backend || options.type;

  // 2. Explicit transport types
  if (backend === 'memory' || options.memory === true) {
    return new MemoryTransport(options);
  }

  if (backend === 'console' || options.console === true) {
    return new ConsoleTransport(options);
  }

  if (backend === 'file' || options.fileDir) {
    return new FileTransport({ dir: options.fileDir || options.dir });
  }

  // 3. SMTP configuration
  const smtp = options.smtp || smtpFromEnv();
  if (smtp && nodemailer) {
    return nodemailer.createTransport(smtp);
  }

  // 4. Fallback defaults by environment
  const env = process.env.NODE_ENV || 'development';
  if (env === 'test') {
    return new MemoryTransport(options);
  }

  if (!smtp) {
    // If running in development with no SMTP, gracefully use MemoryTransport
    return new MemoryTransport(options);
  }

  if (!nodemailer) {
    throw new Error('nodemailer is required for SMTP transport. Install it with: npm install nodemailer');
  }

  return nodemailer.createTransport(smtp);
}

module.exports = {
  MemoryTransport,
  ConsoleTransport,
  FileTransport,
  resolveTransport,
  smtpFromEnv,
};

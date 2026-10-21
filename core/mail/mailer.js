/**
 * Core Mailer Service (AdonisJS & Django-inspired)
 * @module core/mail/mailer
 */

const { Mailable } = require('./mailable');
const { resolveTransport, MemoryTransport } = require('./transports');

/**
 * Mailer service for managing email dispatch, previewing, and outbox tracking
 */
class Mailer {
  /**
   * @param {Object} [options={}]
   * @param {Object} [options.transport] - Custom transport or options for resolveTransport
   * @param {Object} [options.defaults] - Default from/replyTo
   * @param {Function} [options.renderer] - Template renderer function (template, data) => Promise<{ html, text }>
   * @param {Object} [options.events] - Optional event emitter / signal dispatcher
   * @param {Function} [options.logger] - Optional logger
   */
  constructor(options = {}) {
    this.options = options;
    this.transport = resolveTransport(options);
    this.defaults = options.defaults || {};
    this.renderer = options.renderer || null;
    this.events = options.events || null;
    this.logger = options.logger || console;
  }

  /**
   * Send an email using a Mailable instance or raw options object
   * @param {Mailable|Object} mailableOrOptions
   * @returns {Promise<Object>}
   */
  async send(mailableOrOptions) {
    if (!mailableOrOptions) {
      throw new Error('mailableOrOptions is required to send email');
    }

    const msg = mailableOrOptions instanceof Mailable
      ? mailableOrOptions.toMessage()
      : { ...mailableOrOptions };

    if (!msg.to || (Array.isArray(msg.to) && msg.to.length === 0)) {
      throw new Error('Email recipient "to" is required');
    }
    if (!msg.subject) {
      throw new Error('Email "subject" is required');
    }

    // Default from
    if (!msg.from && this.defaults.from) {
      msg.from = this.defaults.from;
    }
    if (!msg.replyTo && this.defaults.replyTo) {
      msg.replyTo = this.defaults.replyTo;
    }

    // Render template if template identifier provided and renderer configured
    if (msg.template && this.renderer && typeof this.renderer === 'function') {
      const rendered = await this.renderer(msg.template, msg.data || {});
      if (rendered) {
        msg.html = rendered.html || msg.html;
        msg.text = rendered.text || msg.text;
      }
    }

    // Fallback simple text from HTML if text not provided
    if (!msg.text && typeof msg.html === 'string') {
      msg.text = msg.html.replace(/<[^<>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    try {
      const result = await this.transport.sendMail(msg);

      if (this.events && typeof this.events.emit === 'function') {
        this.events.emit('mail:sent', { message: msg, result });
      }

      return {
        ok: true,
        messageId: result.messageId,
        response: result.response,
        accepted: result.accepted,
        rejected: result.rejected,
        result,
      };
    } catch (err) {
      if (this.events && typeof this.events.emit === 'function') {
        this.events.emit('mail:failed', { message: msg, error: err });
      }
      throw err;
    }
  }

  /**
   * Preview a Mailable without sending
   * @param {Mailable|Object} mailableOrOptions
   * @returns {Promise<Object>}
   */
  async preview(mailableOrOptions) {
    if (!mailableOrOptions) {
      throw new Error('mailableOrOptions is required to preview email');
    }

    const msg = mailableOrOptions instanceof Mailable
      ? mailableOrOptions.toMessage()
      : { ...mailableOrOptions };

    if (msg.template && this.renderer && typeof this.renderer === 'function') {
      const rendered = await this.renderer(msg.template, msg.data || {});
      if (rendered) {
        msg.html = rendered.html || msg.html;
        msg.text = rendered.text || msg.text;
      }
    }

    return {
      to: msg.to,
      from: msg.from || this.defaults.from,
      subject: msg.subject,
      html: msg.html || '',
      text: msg.text || '',
      data: msg.data || {},
      attachments: msg.attachments || [],
      headers: msg.headers || {},
    };
  }

  /**
   * Get messages from in-memory outbox (if MemoryTransport active)
   * @returns {Array<Object>}
   */
  getOutbox() {
    if (this.transport && typeof this.transport.getOutbox === 'function') {
      return this.transport.getOutbox();
    }
    return [];
  }

  /**
   * Clear in-memory outbox
   */
  clearOutbox() {
    if (this.transport && typeof this.transport.clearOutbox === 'function') {
      this.transport.clearOutbox();
    }
  }

  /**
   * Get latest sent message from outbox
   * @returns {Object|null}
   */
  lastMessage() {
    if (this.transport && typeof this.transport.lastMessage === 'function') {
      return this.transport.lastMessage();
    }
    return null;
  }

  /**
   * Check connection/transport health
   */
  async verify() {
    if (this.transport && typeof this.transport.verify === 'function') {
      return this.transport.verify();
    }
    return true;
  }
}

/**
 * Factory to create Mailer instance
 * @param {Object} options
 * @returns {Mailer}
 */
function createMailer(options = {}) {
  return new Mailer(options);
}

module.exports = {
  Mailer,
  createMailer,
};

/**
 * Declarative Mailable Base Class (AdonisJS & Laravel-inspired)
 * @module core/mail/mailable
 */

/**
 * Base class for declarative, reusable email templates
 */
class Mailable {
  constructor() {
    this.message = {
      to: [],
      from: null,
      replyTo: null,
      cc: [],
      bcc: [],
      subject: '',
      template: null,
      html: null,
      text: null,
      mjml: null,
      data: {},
      attachments: [],
      headers: {},
    };
  }

  /**
   * Add recipient(s)
   * @param {string|string[]|Object} recipient
   * @param {string} [name]
   * @returns {this}
   */
  to(recipient, name) {
    if (Array.isArray(recipient)) {
      this.message.to.push(...recipient);
    } else if (name && typeof recipient === 'string') {
      this.message.to.push({ address: recipient, name });
    } else if (recipient) {
      this.message.to.push(recipient);
    }
    return this;
  }

  /**
   * Set sender address
   * @param {string} address
   * @param {string} [name]
   * @returns {this}
   */
  from(address, name) {
    this.message.from = name ? { address, name } : address;
    return this;
  }

  /**
   * Set reply-to address
   * @param {string} address
   * @returns {this}
   */
  replyTo(address) {
    this.message.replyTo = address;
    return this;
  }

  /**
   * Add CC recipient(s)
   * @param {string|string[]} recipient
   * @returns {this}
   */
  cc(recipient) {
    if (Array.isArray(recipient)) {
      this.message.cc.push(...recipient);
    } else if (recipient) {
      this.message.cc.push(recipient);
    }
    return this;
  }

  /**
   * Add BCC recipient(s)
   * @param {string|string[]} recipient
   * @returns {this}
   */
  bcc(recipient) {
    if (Array.isArray(recipient)) {
      this.message.bcc.push(...recipient);
    } else if (recipient) {
      this.message.bcc.push(recipient);
    }
    return this;
  }

  /**
   * Set email subject line
   * @param {string} subj
   * @returns {this}
   */
  subject(subj) {
    this.message.subject = subj;
    return this;
  }

  /**
   * Set template name / identifier
   * @param {string} tplName
   * @returns {this}
   */
  template(tplName) {
    this.message.template = tplName;
    return this;
  }

  /**
   * Set raw HTML body
   * @param {string} htmlContent
   * @returns {this}
   */
  html(htmlContent) {
    this.message.html = htmlContent;
    return this;
  }

  /**
   * Set plain text body
   * @param {string} textContent
   * @returns {this}
   */
  text(textContent) {
    this.message.text = textContent;
    return this;
  }

  /**
   * Set MJML template string
   * @param {string} mjmlContent
   * @returns {this}
   */
  mjml(mjmlContent) {
    this.message.mjml = mjmlContent;
    return this;
  }

  /**
   * Set template view and/or view data
   * @param {string|Object} templateOrData
   * @param {Object} [data]
   * @returns {this}
   */
  view(templateOrData, data) {
    if (typeof templateOrData === 'string') {
      this.message.template = templateOrData;
      if (data && typeof data === 'object') {
        Object.assign(this.message.data, data);
      }
    } else if (templateOrData && typeof templateOrData === 'object') {
      Object.assign(this.message.data, templateOrData);
    }
    return this;
  }

  /**
   * Assign template data
   * @param {string|Object} keyOrObj
   * @param {*} [value]
   * @returns {this}
   */
  data(keyOrObj, value) {
    if (typeof keyOrObj === 'string') {
      this.message.data[keyOrObj] = value;
    } else if (keyOrObj && typeof keyOrObj === 'object') {
      Object.assign(this.message.data, keyOrObj);
    }
    return this;
  }

  /**
   * Add attachment
   * @param {Object} attachment
   * @returns {this}
   */
  attach(attachment) {
    if (attachment) {
      this.message.attachments.push(attachment);
    }
    return this;
  }

  /**
   * Set custom header
   * @param {string} key
   * @param {string} value
   * @returns {this}
   */
  header(key, value) {
    this.message.headers[key] = value;
    return this;
  }

  /**
   * Subclass hook executed before sending
   */
  prepare() {}

  /**
   * Subclass hook executed to build email definition
   */
  build() {}

  /**
   * Convert to normalized message payload object
   * @returns {Object}
   */
  toMessage() {
    // Copy any class field declarations (e.g. `template = 'welcome'`, `subjectText = 'Hi'`)
    if (!this.message.template && typeof this.template === 'string') {
      this.message.template = this.template;
    }
    if (!this.message.subject && (this.subjectText || this._subject)) {
      this.message.subject = this.subjectText || this._subject;
    }
    if (!this.message.from && this.fromAddress) {
      this.message.from = this.fromAddress;
    }

    this.prepare();
    this.build();

    const msg = {
      ...this.message,
      data: { ...this.message.data },
      attachments: [...this.message.attachments],
      headers: { ...this.message.headers },
    };

    if (Array.isArray(msg.to)) {
      if (msg.to.length === 1) {
        msg.to = msg.to[0];
      } else if (msg.to.length === 0) {
        msg.to = null;
      }
    }

    return msg;
  }
}

module.exports = {
  Mailable,
};

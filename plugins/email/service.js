/**
 * Email service — send, preview, verify, logging
 * @module plugins/email/service
 */

const { renderSource } = require('./render');
const { createTransport, resolveDefaultFrom } = require('./transport');

/**
 * @param {Object} options
 * @param {import('./template-registry').TemplateRegistry} options.registry
 * @param {Object} [options.transportOptions]
 * @param {Object} [options.defaults]
 * @param {import('knex').Knex|null} [options.knex]
 * @param {boolean} [options.logToDb=false]
 * @param {string} [options.tableName='email_logs']
 */
function createEmailService(options) {
  const registry = options.registry;
  const defaults = options.defaults || {};
  const knex = options.knex || null;
  const logToDb = options.logToDb === true && !!knex;
  const tableName = options.tableName || 'email_logs';

  let transport;
  try {
    transport = createTransport(options.transportOptions || {});
  } catch (err) {
    transport = null;
    console.warn('[email]', err.message);
  }

  /**
   * @param {Object} row
   */
  async function writeLog(row) {
    if (!logToDb) return;
    try {
      await knex(tableName).insert({
        to: row.to || null,
        cc: row.cc || null,
        bcc: row.bcc || null,
        subject: row.subject || null,
        template_id: row.template_id || null,
        from: row.from || null,
        status: row.status,
        message_id: row.message_id || null,
        error: row.error || null,
        created_at: new Date(),
      });
    } catch (err) {
      console.warn('[email] Failed to write email log:', err.message);
    }
  }

  /**
   * @param {Object} sendOptions
   * @returns {Promise<Object>}
   */
  async function send(sendOptions = {}) {
    if (!transport) {
      throw new Error('Email transport is not configured');
    }

    const payload = (sendOptions && typeof sendOptions.toMessage === 'function')
      ? sendOptions.toMessage()
      : sendOptions;

    const {
      to,
      cc,
      bcc,
      subject,
      from,
      replyTo,
      template,
      mjml,
      html,
      text,
      data = {},
      attachments,
    } = payload;

    if (!to) {
      throw new Error('Email "to" is required');
    }
    if (!subject) {
      throw new Error('Email "subject" is required');
    }

    let renderedHtml = html;
    let renderedText = text;
    let mjmlErrors = [];
    let templateId = template || null;

    if (template) {
      const entry = registry.get(template);
      if (!entry) {
        throw new Error(`Unknown email template: ${template}`);
      }
      const rendered = await renderSource(entry.source, data);
      renderedHtml = rendered.html || renderedHtml;
      renderedText = rendered.text || renderedText;
      mjmlErrors = rendered.errors || [];
    } else if (mjml) {
      const rendered = await renderSource({ mjml }, data);
      renderedHtml = rendered.html;
      mjmlErrors = rendered.errors || [];
    } else if (html && data && Object.keys(data).length) {
      const rendered = await renderSource({ html }, data);
      renderedHtml = rendered.html;
    }

    const mailOptions = {
      to,
      cc,
      bcc,
      subject,
      from: from || resolveDefaultFrom(defaults),
      replyTo: replyTo || defaults.replyTo,
      html: renderedHtml,
      text: renderedText,
      attachments,
    };

    try {
      const info = await transport.sendMail(mailOptions);
      await writeLog({
        to: Array.isArray(to) ? to.join(',') : String(to),
        cc: cc ? (Array.isArray(cc) ? cc.join(',') : String(cc)) : null,
        bcc: bcc ? (Array.isArray(bcc) ? bcc.join(',') : String(bcc)) : null,
        subject,
        template_id: templateId,
        from: mailOptions.from,
        status: 'sent',
        message_id: info.messageId || null,
      });
      return { ok: true, messageId: info.messageId, mjmlErrors };
    } catch (err) {
      await writeLog({
        to: Array.isArray(to) ? to.join(',') : String(to),
        cc: cc ? (Array.isArray(cc) ? cc.join(',') : String(cc)) : null,
        bcc: bcc ? (Array.isArray(bcc) ? bcc.join(',') : String(bcc)) : null,
        subject,
        template_id: templateId,
        from: mailOptions.from,
        status: 'failed',
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * @param {string} name
   * @param {Object} options
   */
  async function sendTemplate(name, options = {}) {
    return send({ ...options, template: name });
  }

  /**
   * @param {string|Object} nameOrOptions
   * @param {Object} [data={}]
   */
  async function preview(nameOrOptions, data = {}) {
    const target = (nameOrOptions && typeof nameOrOptions.toMessage === 'function')
      ? nameOrOptions.toMessage()
      : nameOrOptions;

    if (typeof target === 'string') {
      const entry = registry.get(target);
      if (!entry) {
        throw new Error(`Unknown email template: ${target}`);
      }
      return renderSource(entry.source, data);
    }

    if (target.template) {
      const entry = registry.get(target.template);
      if (!entry) {
        throw new Error(`Unknown email template: ${target.template}`);
      }
      return renderSource(entry.source, target.data || data);
    }

    if (target.mjml) {
      return renderSource({ mjml: target.mjml }, target.data || data);
    }

    if (target.html) {
      return renderSource({ html: target.html }, target.data || data);
    }

    throw new Error('preview requires template id, mjml, or html');
  }

  async function verifyConnection() {
    if (!transport) {
      throw new Error('Email transport is not configured');
    }
    return transport.verify();
  }

  /**
   * @param {Object} [filters={}]
   */
  async function queryLogs(filters = {}) {
    if (!knex) return [];

    const page = Math.max(1, parseInt(filters.page, 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(filters.perPage, 10) || 25));
    const offset = filters.offset != null ? Math.max(0, filters.offset) : (page - 1) * perPage;
    const limit = filters.limit != null ? Math.min(500, filters.limit) : perPage;

    let qb = knex(tableName).orderBy('created_at', 'desc');

    if (filters.status) qb = qb.where('status', String(filters.status));
    if (filters.template) qb = qb.where('template_id', String(filters.template));
    if (filters.from) qb = qb.where('created_at', '>=', String(filters.from));
    if (filters.to) qb = qb.where('created_at', '<=', String(filters.to));

    const rows = await qb.offset(offset).limit(limit);

    if (filters.includeTotal) {
      let countQ = knex(tableName);
      if (filters.status) countQ = countQ.where('status', String(filters.status));
      if (filters.template) countQ = countQ.where('template_id', String(filters.template));
      if (filters.from) countQ = countQ.where('created_at', '>=', String(filters.from));
      if (filters.to) countQ = countQ.where('created_at', '<=', String(filters.to));
      const countRow = await countQ.count('* as cnt').first();
      const total = Number(countRow?.cnt ?? Object.values(countRow || {})[0] ?? 0);
      return { data: rows, meta: { page, perPage: limit, total, offset } };
    }

    return rows;
  }

  return {
    send,
    sendTemplate,
    preview,
    verifyConnection,
    queryLogs,
    getTransport: () => transport,
    isTransportReady: () => !!transport,
    getOutbox: () => (transport && typeof transport.getOutbox === 'function' ? transport.getOutbox() : []),
    clearOutbox: () => (transport && typeof transport.clearOutbox === 'function' ? transport.clearOutbox() : undefined),
    lastMessage: () => (transport && typeof transport.lastMessage === 'function' ? transport.lastMessage() : null),
  };
}

module.exports = {
  createEmailService,
};

/**
 * Admin API handlers for email plugin
 * @module plugins/email/api-handlers
 */

const { purgeEmailLogs } = require('./purge');
const { safeJsonParse } = require('../../core/utils/json');

/**
 * @param {Object} options
 * @param {ReturnType<import('./service').createEmailService>} options.emailService
 * @param {import('./template-registry').TemplateRegistry} options.registry
 * @param {import('knex').Knex|null} [options.knex]
 * @param {string} [options.tableName='email_logs']
 */
function createEmailApiHandlers(options) {
  const emailService = options.emailService;
  const registry = options.registry;
  const knex = options.knex || null;
  const tableName = options.tableName || 'email_logs';

  async function listLogsHandler(req, res) {
    try {
      const result = await emailService.queryLogs({
        page: req.query.page,
        perPage: req.query.perPage,
        status: req.query.status,
        template: req.query.template,
        from: req.query.from,
        to: req.query.to,
        search: req.query.search || req.query.q,
        includeTotal: true,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async function getLogHandler(req, res) {
    try {
      const id = req.params?.id || req.query?.id;
      if (!id) {
        return res.status(400).json({ error: 'id parameter is required' });
      }
      const log = await emailService.getLogById(id);
      if (!log) {
        return res.status(404).json({ error: `Email log #${id} not found` });
      }
      res.json({ ok: true, data: log });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async function resendHandler(req, res) {
    try {
      const body = req.body || {};
      const id = body.id || body.logId || req.params?.id;
      if (!id) {
        return res.status(400).json({ error: 'id is required to resend email log' });
      }
      const overrides = {};
      if (body.to) overrides.to = body.to;
      if (body.subject) overrides.subject = body.subject;
      if (body.data) overrides.data = safeJsonParse(body.data, body.data);

      const result = await emailService.resendLog(id, overrides);
      res.json({ ok: true, message: `Email log #${id} resent successfully`, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async function sendTestHandler(req, res) {
    try {
      const body = req.body || {};
      const { to, subject, template, mjml, html, data } = body;

      if (!to || !subject) {
        return res.status(400).json({ error: 'to and subject are required' });
      }

      const parsedData = safeJsonParse(data, {}) || {};

      const result = await emailService.send({
        to,
        subject,
        template,
        mjml,
        html,
        data: parsedData,
      });

      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async function previewHandler(req, res) {
    try {
      const body = req.body || {};
      const { template, mjml, html, data } = body;

      const parsedData = safeJsonParse(data, {}) || {};

      const result = await emailService.preview(
        template ? { template, data: parsedData } : { mjml, html, data: parsedData }
      );

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async function verifyHandler(req, res) {
    try {
      await emailService.verifyConnection();
      res.json({ ok: true, message: 'SMTP connection verified' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  const SAMPLE_DATA_MAP = {
    'auth-password-reset': { name: 'Ahmet Yılmaz', resetUrl: 'https://example.com/auth/reset?token=sample-reset-123' },
    'auth-email-verify': { name: 'Ahmet Yılmaz', verifyUrl: 'https://example.com/auth/verify?token=sample-verify-456' },
    'auth-welcome': { name: 'Ahmet Yılmaz' },
    'auth-magic-link': { name: 'Ahmet Yılmaz', magicLinkUrl: 'https://example.com/auth/magic?token=sample-magic-789', expiresMinutes: 15 },
  };

  async function templatesHandler(req, res) {
    const list = registry.list() || [];
    const enriched = list.map((t) => ({
      ...t,
      sampleData: SAMPLE_DATA_MAP[t.id] || { name: 'Sample Recipient', actionUrl: 'https://example.com' },
    }));
    res.json({ data: enriched });
  }

  async function purgeHandler(req, res) {
    if (!knex) {
      return res.status(400).json({ error: 'Database logging is not enabled' });
    }

    try {
      const days = parseInt(req.body?.days || req.query?.days || '90', 10);
      if (Number.isNaN(days) || days < 1) {
        return res.status(400).json({ error: 'days must be a positive integer' });
      }

      const olderThan = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const deleted = await purgeEmailLogs(knex, { tableName, olderThan });
      res.json({ ok: true, deleted, olderThan: olderThan.toISOString() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  return {
    listLogsHandler,
    getLogHandler,
    resendHandler,
    sendTestHandler,
    previewHandler,
    verifyHandler,
    templatesHandler,
    purgeHandler,
  };
}

module.exports = {
  createEmailApiHandlers,
};

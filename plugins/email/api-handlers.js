/**
 * Admin API handlers for email plugin
 * @module plugins/email/api-handlers
 */

const { purgeEmailLogs } = require('./purge');

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
        includeTotal: true,
      });
      res.json(result);
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

      let parsedData = data;
      if (typeof data === 'string') {
        try {
          parsedData = JSON.parse(data);
        } catch {
          parsedData = {};
        }
      }

      const result = await emailService.send({
        to,
        subject,
        template,
        mjml,
        html,
        data: parsedData || {},
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

      let parsedData = data;
      if (typeof data === 'string') {
        try {
          parsedData = JSON.parse(data);
        } catch {
          parsedData = {};
        }
      }

      const result = await emailService.preview(
        template ? { template, data: parsedData || {} } : { mjml, html, data: parsedData || {} }
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

  async function templatesHandler(req, res) {
    res.json({ data: registry.list() });
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

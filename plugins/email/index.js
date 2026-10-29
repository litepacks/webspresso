/**
 * Email plugin — MJML + Nodemailer
 * @module plugins/email
 */

const { TemplateRegistry } = require('./template-registry');
const { createEmailService } = require('./service');
const { createEmailApiHandlers } = require('./api-handlers');
const { generateEmailComponent } = require('./admin-component');
const { generateEmailLogsMigration } = require('./migration-template');
const { purgeEmailLogs } = require('./purge');
const { wireAuthEmails, registerAuthEmailRoutes } = require('./auth-bridge');
const { emailPluginOptionsFromManifest } = require('./manifest');
const { Mailable } = require('../../core/mail/mailable');
const { createMailer } = require('../../core/mail/mailer');
const { setAppContext } = require('../../src/app-context');

/**
 * @param {Object} options
 * @param {Object} [options.db] - Database instance (must expose .knex)
 * @param {Object} [options.transport] - Nodemailer transport instance
 * @param {Object} [options.smtp] - SMTP options
 * @param {Object} [options.defaults] - Default from/replyTo
 * @param {string} [options.templatesDir] - Directory of *.mjml templates
 * @param {Object} [options.templates] - Template map
 * @param {boolean} [options.logToDb] - Log sends to DB (default true when db present)
 * @param {string} [options.tableName='email_logs']
 * @param {boolean} [options.includeAdminPage=true]
 * @param {string} [options.adminPath='/_admin']
 * @param {string} [options.apiPrefix='/email']
 * @param {Object} [options.auth] - AuthManager instance
 * @param {Object} [options.authEmails] - Auth email bridge config
 * @param {Object} [options.emailTemplates] - Precompiled templates from build manifest
 * @param {Object} [options.manifest] - Full build manifest (uses emailTemplates field)
 * @param {Object|boolean} [options.retention] - Retention policy configuration (set false to disable)
 * @param {number} [options.retention.days=90] - Days to retain email logs
 * @param {number} [options.retention.intervalMs=86400000] - Auto-cleanup timer frequency (24h)
 * @param {boolean} [options.retention.runOnStart=true] - Run initial purge shortly after startup
 * @param {number} [options.retentionDays=90] - Shorthand for retention.days
 * @param {number} [options.cleanupIntervalMs=86400000] - Shorthand for retention.intervalMs
 * @param {boolean} [options.autoCleanup=true] - Enable automatic background cleanup
 * @param {boolean} [options.cleanupOnStart=true] - Run initial purge on start
 * @param {number} [options.cleanupStartDelayMs] - Delay in ms before start purge
 */
function emailPlugin(options = {}) {
  const {
    db,
    title,
    adminTitle,
    transport,
    smtp,
    defaults = {},
    templatesDir,
    templates = {},
    tableName = 'email_logs',
    includeAdminPage = true,
    adminPath: adminPathOpt,
    apiPrefix = '/email',
    auth: authOption,
    authEmails,
    emailTemplates: emailTemplatesOpt,
    manifest,
  } = options;

  const pageTitle = title || adminTitle || 'Email';

  const logToDb = options.logToDb !== undefined ? options.logToDb : !!db;
  const knex = db ? (db.knex || db) : null;

  if (logToDb && !db) {
    console.warn('[email] logToDb is enabled but no db was passed — logging disabled');
  }

  // Retention configuration
  const retentionOption = options.retention;
  const isRetentionDisabled =
    retentionOption === false ||
    (typeof retentionOption === 'object' && retentionOption.enabled === false) ||
    options.retentionDays === null ||
    options.retentionDays === 0 ||
    !logToDb ||
    !knex;

  const autoCleanupEnabled =
    !isRetentionDisabled &&
    options.autoCleanup !== false &&
    (typeof retentionOption !== 'object' || retentionOption.autoCleanup !== false);

  const retentionConfig = {
    enabled: !isRetentionDisabled,
    autoCleanup: autoCleanupEnabled,
    days: (typeof options.retentionDays === 'number' && options.retentionDays > 0)
      ? options.retentionDays
      : (typeof retentionOption === 'object' && retentionOption?.days ? retentionOption.days : 90),
    intervalMs: (typeof options.cleanupIntervalMs === 'number' && options.cleanupIntervalMs > 0)
      ? options.cleanupIntervalMs
      : (typeof retentionOption === 'object' && retentionOption?.intervalMs ? retentionOption.intervalMs : 24 * 60 * 60 * 1000),
    runOnStart: (typeof retentionOption === 'object' && retentionOption?.runOnStart !== undefined)
      ? !!retentionOption.runOnStart
      : (options.cleanupOnStart !== undefined ? !!options.cleanupOnStart : true),
  };

  let cleanupInterval = null;
  let cleanupStartTimeout = null;

  async function runCleanup() {
    if (!knex) return 0;
    try {
      return await purgeEmailLogs(knex, {
        tableName,
        days: retentionConfig.days,
      });
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[email] Failed to run retention cleanup:', err.message);
      }
    }
  }

  function startCleanup(customIntervalMs) {
    stopCleanup();
    if (!retentionConfig.enabled || !knex) return;
    if (typeof customIntervalMs === 'number' && customIntervalMs > 0) {
      retentionConfig.intervalMs = customIntervalMs;
    }

    if (retentionConfig.runOnStart) {
      const delayMs = typeof options.cleanupStartDelayMs === 'number'
        ? options.cleanupStartDelayMs
        : (process.env.NODE_ENV === 'test' ? 50 : 5000);
      cleanupStartTimeout = setTimeout(() => {
        runCleanup();
      }, delayMs);
      if (cleanupStartTimeout && cleanupStartTimeout.unref) {
        cleanupStartTimeout.unref();
      }
    }

    cleanupInterval = setInterval(() => {
      runCleanup();
    }, retentionConfig.intervalMs);
    if (cleanupInterval && cleanupInterval.unref) {
      cleanupInterval.unref();
    }
  }

  function stopCleanup() {
    if (cleanupStartTimeout) {
      clearTimeout(cleanupStartTimeout);
      cleanupStartTimeout = null;
    }
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
  }

  const registry = new TemplateRegistry();

  const manifestChunks = emailTemplatesOpt
    || manifest?.emailTemplates
    || null;
  if (manifestChunks) {
    registry.loadFromManifest(manifestChunks);
  }

  if (templatesDir) registry.loadFromDir(templatesDir);
  registry.loadFromMap(templates);

  const emailService = createEmailService({
    registry,
    transportOptions: { transport, smtp },
    defaults,
    knex: logToDb ? knex : null,
    logToDb: logToDb && !!knex,
    tableName,
  });

  const mailer = {
    send: (opts) => emailService.send(opts),
    sendTemplate: (name, opts) => emailService.sendTemplate(name, opts),
    preview: (opts, data) => emailService.preview(opts, data),
    getOutbox: () => emailService.getOutbox(),
    clearOutbox: () => emailService.clearOutbox(),
    lastMessage: () => emailService.lastMessage(),
    verify: () => emailService.verifyConnection(),
    getTransport: () => emailService.getTransport(),
  };

  let wiredAuthEmailsConfig = null;

  return {
    name: 'email',
    version: '1.0.0',
    description: 'MJML + Nodemailer email sending with optional admin UI, auth integration, and retention cleanup',
    dependencies: includeAdminPage ? { 'admin-panel': '*' } : {},

    api: {
      mailer,
      Mailable,
      send: (opts) => emailService.send(opts),
      sendTemplate: (name, opts) => emailService.sendTemplate(name, opts),
      preview: (nameOrOpts, data) => emailService.preview(nameOrOpts, data),
      getOutbox: () => emailService.getOutbox(),
      clearOutbox: () => emailService.clearOutbox(),
      lastMessage: () => emailService.lastMessage(),
      registerTemplate: (id, source) => registry.register(id, source),
      listTemplates: () => registry.list(),
      verifyConnection: () => emailService.verifyConnection(),
      queryLogs: (filters) => emailService.queryLogs(filters),
      getLogById: (id) => emailService.getLogById(id),
      resendLog: (id, overrides) => emailService.resendLog(id, overrides),
      purge: (opts = {}) => {
        if (!knex) throw new Error('Database is required for purge');
        return purgeEmailLogs(knex, {
          tableName: opts.tableName || tableName,
          days: opts.days !== undefined ? opts.days : (opts.retentionDays !== undefined ? opts.retentionDays : retentionConfig.days),
          olderThan: opts.olderThan,
          ...opts,
        });
      },
      purgeLogs: (opts = {}) => {
        if (!knex) throw new Error('Database is required for purgeLogs');
        return purgeEmailLogs(knex, {
          tableName: opts.tableName || tableName,
          olderThan: opts.olderThan,
          days: opts.days !== undefined ? opts.days : (opts.retentionDays !== undefined ? opts.retentionDays : retentionConfig.days),
          ...opts,
        });
      },
      startCleanup,
      stopCleanup,
      getRetentionConfig() {
        return { ...retentionConfig };
      },
      getMigrationTemplate: (name) => generateEmailLogsMigration(name || tableName),
      isTransportReady: () => emailService.isTransportReady(),
      loadFromManifest: (chunks) => registry.loadFromManifest(chunks),
      emailPluginOptionsFromManifest,
    },

    register(ctx) {
      setAppContext({ mailer });
      if (ctx.app) {
        ctx.app.mailer = mailer;
      }
      const target = ctx.http || ctx.app;
      if (target && typeof target.use === 'function') {
        target.use((req, res, next) => {
          req.mailer = mailer;
          next();
        });
      }
      ctx.mailer = mailer;

      const registry = ctx.serviceRegistry || ctx.services || ctx.app?.serviceRegistry;
      if (registry) {
        const { createMailServices } = require('../../src/services/builtins/mail');
        const mailServices = createMailServices({
          emailService,
          registry,
          db,
          tableName,
        });
        for (const [name, def] of Object.entries(mailServices)) {
          if (!registry.has(name)) {
            registry.register(name, def);
          }
        }
      }

      if (retentionConfig.enabled && autoCleanupEnabled) {
        startCleanup();
      }

      return () => {
        stopCleanup();
      };
    },

    dispose() {
      stopCleanup();
    },

    shutdown() {
      stopCleanup();
    },

    onRoutesReady(ctx) {
      const authManager = authOption || ctx.options?.auth || null;

      if (authEmails?.enabled && authManager) {
        wiredAuthEmailsConfig = wireAuthEmails(
          authManager,
          emailService,
          registry,
          authEmails,
          db
        );
        registerAuthEmailRoutes({
          authManager,
          ctx,
          authEmailsConfig: wiredAuthEmailsConfig,
        });
      } else if (authEmails?.enabled && !authManager) {
        console.warn('[email] authEmails.enabled but no auth manager found — pass auth to createApp or emailPlugin');
      }

      // Mount Dev Mail Preview & Inbox
      const enableDevInbox = options.devInbox !== false && (process.env.NODE_ENV !== 'production' || options.devInbox === true);
      if (enableDevInbox && typeof ctx.addRoute === 'function') {
        const { createMailPreviewHandlers } = require('./preview-handler');
        const previewPath = options.previewPath || '/_webspresso/mail-preview';
        const previewHandlers = createMailPreviewHandlers({ mailer, basePath: previewPath });

        ctx.addRoute('get', previewPath, previewHandlers.indexHandler);
        ctx.addRoute('get', `${previewPath}/api/messages`, previewHandlers.listMessagesHandler);
        ctx.addRoute('get', `${previewPath}/api/messages/:id`, previewHandlers.getMessageHandler);
        ctx.addRoute('get', `${previewPath}/api/messages/:id/html`, previewHandlers.getMessageHtmlHandler);
        ctx.addRoute('post', `${previewPath}/api/clear`, previewHandlers.clearMessagesHandler);
        ctx.addRoute('post', `${previewPath}/api/preview`, previewHandlers.previewHandler);
      }

      if (!includeAdminPage) return;

      const adminApi = ctx.usePlugin('admin-panel');
      if (!adminApi) {
        console.warn('[email] admin-panel plugin not found, skipping admin page registration');
        return;
      }

      const handlers = createEmailApiHandlers({
        emailService,
        registry,
        knex: logToDb ? knex : null,
        tableName,
      });

      adminApi.registerModule({
        id: 'email',
        title: pageTitle,

        pages: [{
          id: 'email',
          title: pageTitle,
          path: '/email',
          icon: 'mail',
          component: generateEmailComponent({ apiPrefix }),
        }],

        menu: [{
          id: 'email',
          label: 'Email',
          path: '/email',
          icon: 'mail',
          order: 40,
        }],

        api: {
          prefix: apiPrefix,
          routes: [
            { method: 'get', path: '/logs', handler: handlers.listLogsHandler },
            { method: 'get', path: '/logs/:id', handler: handlers.getLogHandler },
            { method: 'get', path: '/templates', handler: handlers.templatesHandler },
            { method: 'post', path: '/send-test', handler: handlers.sendTestHandler },
            { method: 'post', path: '/preview', handler: handlers.previewHandler },
            { method: 'post', path: '/verify', handler: handlers.verifyHandler },
            { method: 'post', path: '/purge', handler: handlers.purgeHandler },
            { method: 'post', path: '/retry', handler: handlers.resendHandler },
            { method: 'post', path: '/resend', handler: handlers.resendHandler },
          ],
        },
      });
    },
  };
}

module.exports = emailPlugin;
module.exports.emailPlugin = emailPlugin;
module.exports.Mailable = Mailable;
module.exports.createMailer = createMailer;
module.exports.generateEmailLogsMigration = generateEmailLogsMigration;
module.exports.purgeEmailLogs = purgeEmailLogs;
module.exports.emailPluginOptionsFromManifest = emailPluginOptionsFromManifest;

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
 */
function emailPlugin(options = {}) {
  const {
    db,
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

  const logToDb = options.logToDb !== undefined ? options.logToDb : !!db;
  const knex = db ? (db.knex || db) : null;

  if (logToDb && !db) {
    console.warn('[email] logToDb is enabled but no db was passed — logging disabled');
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

  let wiredAuthEmailsConfig = null;

  return {
    name: 'email',
    version: '1.0.0',
    description: 'MJML + Nodemailer email sending with optional admin UI and auth integration',
    dependencies: includeAdminPage ? { 'admin-panel': '*' } : {},

    api: {
      send: (opts) => emailService.send(opts),
      sendTemplate: (name, opts) => emailService.sendTemplate(name, opts),
      preview: (nameOrOpts, data) => emailService.preview(nameOrOpts, data),
      registerTemplate: (id, source) => registry.register(id, source),
      listTemplates: () => registry.list(),
      verifyConnection: () => emailService.verifyConnection(),
      queryLogs: (filters) => emailService.queryLogs(filters),
      purgeLogs: (opts = {}) => {
        if (!knex) throw new Error('Database is required for purgeLogs');
        return purgeEmailLogs(knex, {
          tableName: opts.tableName || tableName,
          olderThan: opts.olderThan,
        });
      },
      getMigrationTemplate: (name) => generateEmailLogsMigration(name || tableName),
      isTransportReady: () => emailService.isTransportReady(),
      loadFromManifest: (chunks) => registry.loadFromManifest(chunks),
      emailPluginOptionsFromManifest,
    },

    register(ctx) {
      if (ctx.app && ctx.app.serviceRegistry) {
        const { createMailServices } = require('../../src/services/builtins/mail');
        const mailServices = createMailServices({
          emailService,
          registry,
          db,
          tableName,
        });
        for (const [name, def] of Object.entries(mailServices)) {
          if (!ctx.app.serviceRegistry.has(name)) {
            ctx.app.serviceRegistry.register(name, def);
          }
        }
      }
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

        pages: [{
          id: 'email',
          title: 'Email',
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
            { method: 'get', path: '/templates', handler: handlers.templatesHandler },
            { method: 'post', path: '/send-test', handler: handlers.sendTestHandler },
            { method: 'post', path: '/preview', handler: handlers.previewHandler },
            { method: 'post', path: '/verify', handler: handlers.verifyHandler },
            { method: 'post', path: '/purge', handler: handlers.purgeHandler },
          ],
        },
      });
    },
  };
}

module.exports = emailPlugin;
module.exports.emailPlugin = emailPlugin;
module.exports.generateEmailLogsMigration = generateEmailLogsMigration;
module.exports.purgeEmailLogs = purgeEmailLogs;
module.exports.emailPluginOptionsFromManifest = emailPluginOptionsFromManifest;

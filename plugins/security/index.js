/**
 * Webspresso Security Shield Plugin
 * Comprehensive Threat Defense Suite: Zero-Dependency Headers (Helmet alternative),
 * IP Firewall & Auto-Ban, Honeypot Traps, LFI/Traversal Guard, Brute-Force Shield,
 * and Mithril.js Admin Panel Security Cockpit.
 * @module plugins/security
 */

'use strict';

const { createSecurityHeadersMiddleware } = require('./headers');
const { FirewallManager, createFirewallMiddleware } = require('./firewall');
const { createHoneypotMiddleware } = require('./honeypot');
const { createBruteForceMiddleware } = require('./bruteforce');
const { IncidentRecorder } = require('./incident-recorder');
const { auditSecurityPosture } = require('./audit');

/**
 * Configure Security Shield Plugin
 * 
 * @param {Object} [options]
 * @param {boolean|Object} [options.headers=true] - Security headers configuration
 * @param {boolean|Object} [options.firewall=true] - IP firewall & auto-ban configuration
 * @param {boolean|Object} [options.honeypot=true] - Honeypot traps & traversal detection configuration
 * @param {boolean|Object} [options.bruteForce=true] - Brute-force & credential stuffing defense
 * @param {boolean|Object} [options.incidents=true] - Incident recorder configuration
 * @param {boolean} [options.adminPanel=true] - Enable Admin Panel SPA Security Cockpit
 * @param {string} [options.adminTitle='Security Shield'] - Title in Admin Panel
 * @param {string} [options.adminApiPrefix='/security'] - API prefix inside /_admin/api
 * @param {number} [options.menuOrder=65] - Menu position
 * @returns {Object} Plugin definition
 */
function securityPlugin(options = {}) {
  let firewall = null;
  let incidentRecorder = null;

  return {
    name: 'security',
    version: '1.0.0',
    description: 'Enterprise Security Shield: Native WAF, IP Firewall, Honeypots, Brute-Force & Admin Cockpit',

    register(ctx) {
      const { app } = ctx;

      // 1. Initialize Incident Recorder
      incidentRecorder = new IncidentRecorder(typeof options.incidents === 'object' ? options.incidents : {});

      // 2. Initialize IP Firewall & Auto-Ban Manager
      const firewallOpts = typeof options.firewall === 'object' ? options.firewall : {};
      firewall = new FirewallManager(firewallOpts);

      if (app) {
        // Expose to app & req
        app.firewall = firewall;
        app.set('webspresso.firewall', firewall);
        app.set('webspresso.security', { firewall, incidentRecorder });

        // A. Security Headers Middleware (zero-dependency native Helmet alternative)
        if (options.headers !== false) {
          const headerOpts = typeof options.headers === 'object' ? options.headers : {};
          app.use(createSecurityHeadersMiddleware(headerOpts));
        }

        // B. IP Firewall Check Middleware
        if (options.firewall !== false) {
          app.use(createFirewallMiddleware(firewall));
        }

        // C. Honeypot & Attack Signature Traps Middleware
        if (options.honeypot !== false) {
          const honeypotOpts = typeof options.honeypot === 'object' ? options.honeypot : {};
          app.use(createHoneypotMiddleware({
            ...honeypotOpts,
            firewall,
            incidentRecorder,
          }));
        }

        // D. Brute-Force & Credential Stuffing Guard Middleware
        if (options.bruteForce !== false) {
          const bruteForceOpts = typeof options.bruteForce === 'object' ? options.bruteForce : {};
          app.use(createBruteForceMiddleware({
            ...bruteForceOpts,
            firewall,
            incidentRecorder,
          }));
        }

        // Context injection on request object
        app.use((req, res, next) => {
          req.firewall = firewall;
          req.security = {
            firewall,
            incidentRecorder,
            isBanned: (ip) => firewall.isBanned(ip),
            ban: (ip, opts) => firewall.ban(ip, opts),
            unban: (ip) => firewall.unban(ip),
          };
          next();
        });
      }

      // Expose to ctx
      ctx.firewall = firewall;
      ctx.security = { firewall, incidentRecorder };

      // 3. Register Built-in Framework Security Services
      const registry = ctx.serviceRegistry || ctx.services || ctx.app?.serviceRegistry;
      if (registry && typeof registry.register === 'function') {
        try {
          const { createSecurityServices } = require('../../core/services/builtins/security');
          const services = createSecurityServices({
            firewall,
            incidentRecorder,
            pluginOptions: options,
            app,
          });

          for (const [name, def] of Object.entries(services)) {
            if (!registry.has(name)) {
              registry.register(name, def);
            }
          }
        } catch (svcErr) {
          console.warn('[securityPlugin] Failed to register built-in security services:', svcErr.message);
        }
      }

      this.firewall = firewall;
      this.incidentRecorder = incidentRecorder;
    },

    api: {
      getFirewall: () => firewall,
      getIncidentRecorder: () => incidentRecorder,
      isBanned: (ip) => firewall?.isBanned(ip) || { banned: false },
      ban: (ip, opts) => firewall?.ban(ip, opts),
      unban: (ip) => firewall?.unban(ip),
      listBanned: (opts) => firewall?.listBanned(opts) || { items: [], total: 0 },
      getStats: () => firewall?.getStats(),
      audit: (app) => auditSecurityPosture({ options, firewall, incidentRecorder, app }),
    },

    onRoutesReady(ctx) {
      if (options.adminPanel === false) {
        return;
      }

      const adminApi = ctx.usePlugin ? ctx.usePlugin('admin-panel') : null;
      if (adminApi && typeof adminApi.registerModule === 'function') {
        const { createSecurityApiHandlers } = require('./api-handlers');
        const { generateSecurityComponent } = require('./admin-component');

        const pageTitle = options.adminTitle || 'Security Shield';
        const apiPrefix = options.adminApiPrefix || '/security';
        const menuOrder = options.menuOrder !== undefined ? options.menuOrder : 65;

        const apiHandlers = createSecurityApiHandlers({
          firewall,
          incidentRecorder,
          options,
          app: ctx.app,
        });

        adminApi.registerModule({
          id: 'security',
          title: pageTitle,
          pages: [
            {
              id: 'security',
              title: pageTitle,
              path: '/security',
              icon: 'shield',
              component: generateSecurityComponent({ apiPrefix }),
            },
          ],
          menu: [
            {
              id: 'security',
              label: pageTitle,
              path: '/security',
              icon: 'shield',
              order: menuOrder,
            },
          ],
          api: {
            prefix: apiPrefix,
            routes: [
              { method: 'get', path: '/stats', handler: apiHandlers.getStatsHandler },
              { method: 'get', path: '/banned', handler: apiHandlers.listBannedIpsHandler },
              { method: 'post', path: '/ban', handler: apiHandlers.banIpHandler },
              { method: 'post', path: '/unban', handler: apiHandlers.unbanIpHandler },
              { method: 'delete', path: '/banned/:ip', handler: apiHandlers.unbanIpHandler },
              { method: 'get', path: '/incidents', handler: apiHandlers.listIncidentsHandler },
              { method: 'post', path: '/clear-incidents', handler: apiHandlers.clearIncidentsHandler },
              { method: 'get', path: '/audit', handler: apiHandlers.getAuditHandler },
            ],
          },
        });
      }
    },
  };
}

module.exports = securityPlugin;
module.exports.securityPlugin = securityPlugin;
module.exports.createSecurityHeadersMiddleware = createSecurityHeadersMiddleware;
module.exports.createFirewallMiddleware = createFirewallMiddleware;
module.exports.FirewallManager = FirewallManager;
module.exports.IncidentRecorder = IncidentRecorder;
module.exports.auditSecurityPosture = auditSecurityPosture;

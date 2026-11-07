/**
 * Security Admin REST API Handlers
 * Supplies backend endpoints for the Mithril.js Security Dashboard SPA.
 * @module plugins/security/api-handlers
 */

'use strict';

const { auditSecurityPosture } = require('./audit');

/**
 * Factory for Security API Handlers
 * 
 * @param {Object} context
 * @param {import('./firewall').FirewallManager} context.firewall
 * @param {import('./incident-recorder').IncidentRecorder} context.incidentRecorder
 * @param {Object} [context.options]
 * @param {Object} [context.app]
 * @returns {Record<string, Function>}
 */
function createSecurityApiHandlers(context = {}) {
  const { firewall, incidentRecorder, options = {}, app } = context;

  return {
    /**
     * GET /stats
     */
    async getStatsHandler(req, res) {
      try {
        const firewallStats = firewall.getStats();
        const incidentStats = incidentRecorder.getStats();
        const audit = auditSecurityPosture({ options, firewall, incidentRecorder, app });

        res.json({
          status: 'ok',
          activeBans: firewallStats.activeBans,
          permanentBans: firewallStats.permanentBans,
          autoBans24h: firewallStats.autoBans24h,
          totalBans: firewallStats.totalBans,
          totalViolations: firewallStats.totalViolations,
          whitelistCount: firewallStats.whitelistCount,
          blacklistCount: firewallStats.blacklistCount,
          incidents24h: incidentStats.last24hCount,
          incidentBreakdown: incidentStats.breakdown,
          securityScore: audit.score,
          securityGrade: audit.grade,
          passedChecks: audit.passedChecks,
          totalChecks: audit.totalChecks,
        });
      } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve security stats', message: err.message });
      }
    },

    /**
     * GET /banned
     */
    async listBannedIpsHandler(req, res) {
      try {
        const { page = 1, limit = 25, search, reason } = req.query;
        const result = firewall.listBanned({ page, limit, search, reason });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: 'Failed to list banned IPs', message: err.message });
      }
    },

    /**
     * POST /ban
     */
    async banIpHandler(req, res) {
      try {
        const { ip, reason, duration, meta } = req.body || {};
        if (!ip || typeof ip !== 'string') {
          return res.status(400).json({ error: 'IP address is required.' });
        }

        const record = firewall.ban(ip.trim(), {
          reason: reason || 'manual_ban',
          duration: duration || '24h',
          meta: meta || {},
        });

        if (incidentRecorder) {
          incidentRecorder.record({
            type: 'manual_ban',
            ip: record.ip,
            reason: record.reason,
            actionTaken: 'banned',
            details: { duration, isPermanent: record.isPermanent },
          });
        }

        res.status(201).json({
          status: 'ok',
          message: `IP ${record.ip} successfully banned.`,
          ban: record,
        });
      } catch (err) {
        res.status(400).json({ error: 'Failed to ban IP', message: err.message });
      }
    },

    /**
     * POST /unban
     */
    async unbanIpHandler(req, res) {
      try {
        const ip = req.body?.ip || req.params?.ip;
        if (!ip) {
          return res.status(400).json({ error: 'IP address is required to unban.' });
        }

        const unbanned = firewall.unban(ip);
        if (!unbanned) {
          return res.status(404).json({ error: 'IP was not found in banned list.' });
        }

        res.json({
          status: 'ok',
          message: `IP ${ip} unbanned successfully.`,
        });
      } catch (err) {
        res.status(500).json({ error: 'Failed to unban IP', message: err.message });
      }
    },

    /**
     * GET /incidents
     */
    async listIncidentsHandler(req, res) {
      try {
        const { limit = 50, type, search } = req.query;
        const result = incidentRecorder.list({ limit, type, search });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve security incidents', message: err.message });
      }
    },

    /**
     * POST /clear-incidents
     */
    async clearIncidentsHandler(req, res) {
      try {
        incidentRecorder.clear();
        res.json({ status: 'ok', message: 'Security incidents cleared.' });
      } catch (err) {
        res.status(500).json({ error: 'Failed to clear incidents', message: err.message });
      }
    },

    /**
     * GET /audit
     */
    async getAuditHandler(req, res) {
      try {
        const audit = auditSecurityPosture({ options, firewall, incidentRecorder, app });
        res.json(audit);
      } catch (err) {
        res.status(500).json({ error: 'Failed to run security audit', message: err.message });
      }
    },
  };
}

module.exports = {
  createSecurityApiHandlers,
};

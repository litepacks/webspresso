/**
 * Built-in Security Services
 * @module core/services/builtins/security
 */

'use strict';

const { z } = require('zod');
const { auditSecurityPosture } = require('../../../plugins/security/audit');

/**
 * Create built-in security services map
 * 
 * @param {Object} options
 * @param {import('../../../plugins/security/firewall').FirewallManager} options.firewall
 * @param {import('../../../plugins/security/incident-recorder').IncidentRecorder} options.incidentRecorder
 * @param {Object} [options.pluginOptions]
 * @param {Object} [options.app]
 * @returns {Record<string, Object>}
 */
function createSecurityServices(options = {}) {
  const { firewall, incidentRecorder, pluginOptions = {}, app } = options;

  if (!firewall) {
    throw new Error('firewall instance is required for createSecurityServices');
  }

  return {
    'security.stats': {
      schema: z.object({}).optional(),
      async handler() {
        const firewallStats = firewall.getStats();
        const incidentStats = incidentRecorder ? incidentRecorder.getStats() : { last24hCount: 0, breakdown: {} };
        const audit = auditSecurityPosture({ options: pluginOptions, firewall, incidentRecorder, app });

        return {
          ...firewallStats,
          incidents24h: incidentStats.last24hCount,
          incidentBreakdown: incidentStats.breakdown,
          securityScore: audit.score,
          securityGrade: audit.grade,
          passedChecks: audit.passedChecks,
          totalChecks: audit.totalChecks,
        };
      },
    },

    'security.ban': {
      schema: z.object({
        ip: z.string().min(1),
        reason: z.string().optional(),
        duration: z.union([z.string(), z.number()]).optional(),
        meta: z.record(z.any()).optional(),
      }),
      async handler(input) {
        return firewall.ban(input.ip, {
          reason: input.reason || 'manual_ban',
          duration: input.duration || '24h',
          meta: input.meta,
        });
      },
    },

    'security.unban': {
      schema: z.object({
        ip: z.string().min(1),
      }),
      async handler(input) {
        const success = firewall.unban(input.ip);
        return { success, ip: input.ip };
      },
    },

    'security.list-banned': {
      schema: z.object({
        page: z.number().optional(),
        limit: z.number().optional(),
        search: z.string().optional(),
        reason: z.string().optional(),
      }).optional(),
      async handler(input = {}) {
        return firewall.listBanned(input || {});
      },
    },

    'security.check-ip': {
      schema: z.object({
        ip: z.string().min(1),
      }),
      async handler(input) {
        return firewall.isBanned(input.ip);
      },
    },

    'security.incidents': {
      schema: z.object({
        limit: z.number().optional(),
        type: z.string().optional(),
        search: z.string().optional(),
      }).optional(),
      async handler(input = {}) {
        if (!incidentRecorder) return { items: [], total: 0 };
        return incidentRecorder.list(input || {});
      },
    },

    'security.audit': {
      schema: z.object({}).optional(),
      async handler() {
        return auditSecurityPosture({ options: pluginOptions, firewall, incidentRecorder, app });
      },
    },
  };
}

module.exports = {
  createSecurityServices,
};

/**
 * Security Incident Recorder
 * Memory-bounded circular buffer for auditing threats and live incident telemetry.
 * @module plugins/security/incident-recorder
 */

'use strict';

class IncidentRecorder {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxSize=250] - Maximum number of incidents kept in memory
   */
  constructor(options = {}) {
    this.maxSize = Math.max(10, Math.min(2000, options.maxSize || 250));
    this.incidents = [];
    this.counter = 0;
  }

  /**
   * Record a new security incident
   * @param {Object} data
   * @param {string} data.type - 'honeypot'|'path_traversal'|'bad_bot'|'bruteforce'|'firewall_blocked'|'manual_ban'
   * @param {string} data.ip
   * @param {string} [data.method]
   * @param {string} [data.path]
   * @param {string} [data.userAgent]
   * @param {string} [data.reason]
   * @param {'blocked'|'banned'|'throttled'|'warned'} [data.actionTaken='blocked']
   * @param {Object} [data.details]
   * @returns {Object} The recorded incident
   */
  record(data = {}) {
    this.counter++;
    const incident = {
      id: `sec_${Date.now()}_${this.counter}`,
      timestamp: Date.now(),
      type: data.type || 'generic_threat',
      ip: data.ip || '127.0.0.1',
      method: (data.method || 'GET').toUpperCase(),
      path: data.path || '/',
      userAgent: data.userAgent || 'Unknown',
      reason: data.reason || 'Security threat detected',
      actionTaken: data.actionTaken || 'blocked',
      details: data.details || {},
    };

    this.incidents.unshift(incident);

    // Keep within bounds
    if (this.incidents.length > this.maxSize) {
      this.incidents.length = this.maxSize;
    }

    return incident;
  }

  /**
   * List incidents with optional filtering & pagination
   * @param {Object} [filter]
   * @param {number} [filter.limit=50]
   * @param {string} [filter.type]
   * @param {string} [filter.search]
   * @returns {Object}
   */
  list(filter = {}) {
    const limit = Math.max(1, Math.min(this.maxSize, parseInt(filter.limit, 10) || 50));
    const type = filter.type ? String(filter.type).trim().toLowerCase() : null;
    const search = filter.search ? String(filter.search).trim().toLowerCase() : null;

    let items = [...this.incidents];

    if (type && type !== 'all') {
      items = items.filter(inc => inc.type.toLowerCase() === type);
    }

    if (search) {
      items = items.filter(inc => (
        inc.ip.toLowerCase().includes(search) ||
        inc.path.toLowerCase().includes(search) ||
        inc.reason.toLowerCase().includes(search) ||
        inc.type.toLowerCase().includes(search)
      ));
    }

    return {
      items: items.slice(0, limit),
      total: items.length,
      limit,
    };
  }

  /**
   * Clear all recorded incidents
   */
  clear() {
    this.incidents = [];
  }

  /**
   * Summary breakdown of incidents by type over the last 24h
   * @returns {Object}
   */
  getStats() {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const recent = this.incidents.filter(inc => inc.timestamp >= oneDayAgo);

    const breakdown = {
      honeypot: 0,
      path_traversal: 0,
      bad_bot: 0,
      bruteforce: 0,
      firewall_blocked: 0,
      other: 0,
    };

    for (const inc of recent) {
      if (breakdown[inc.type] !== undefined) {
        breakdown[inc.type]++;
      } else {
        breakdown.other++;
      }
    }

    return {
      totalRecorded: this.counter,
      inMemoryCount: this.incidents.length,
      last24hCount: recent.length,
      breakdown,
    };
  }
}

module.exports = {
  IncidentRecorder,
};

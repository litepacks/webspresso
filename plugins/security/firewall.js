/**
 * IP Firewall, Blacklist, Whitelist, CIDR Matching & Auto-Ban Engine
 * Zero-dependency native Node.js implementation.
 * @module plugins/security/firewall
 */

'use strict';

const EventEmitter = require('events');
const { extractClientIp, parseWindow } = require('../../core/rate-limit/utils');

/**
 * Normalize IP address (strip IPv6 mapped IPv4 prefix, handle localhost)
 * @param {string} ip
 * @returns {string}
 */
function normalizeIp(ip) {
  if (!ip || typeof ip !== 'string') return '127.0.0.1';
  let clean = ip.trim();

  // Strip IPv4-mapped IPv6 addresses (e.g. ::ffff:192.168.1.1)
  if (clean.startsWith('::ffff:')) {
    clean = clean.slice(7);
  }

  // IPv6 localhost
  if (clean === '::1') {
    return '127.0.0.1';
  }

  return clean;
}

/**
 * Convert IPv4 address to 32-bit unsigned integer
 * @param {string} ip
 * @returns {number}
 */
function ipToLong(ip) {
  return ip.split('.').reduce((acc, octet) => {
    return ((acc << 8) + parseInt(octet, 10)) >>> 0;
  }, 0);
}

/**
 * Check if an IP matches a target IP or CIDR subnet (e.g. '192.168.1.0/24')
 * @param {string} ip
 * @param {string} pattern
 * @returns {boolean}
 */
function matchIpOrCidr(ip, pattern) {
  const normIp = normalizeIp(ip);
  const normPattern = normalizeIp(pattern);

  if (!normPattern.includes('/')) {
    return normIp === normPattern;
  }

  const [range, bitsStr] = normPattern.split('/');
  const bits = parseInt(bitsStr, 10);

  // Validate IPv4 CIDR
  if (Number.isNaN(bits) || bits < 0 || bits > 32) {
    return false;
  }

  // Exact 32 bits
  if (bits === 32) {
    return normIp === range;
  }
  if (bits === 0) {
    return true;
  }

  const mask = bits === 0 ? 0 : (~((1 << (32 - bits)) - 1)) >>> 0;
  const ipLong = ipToLong(normIp);
  const rangeLong = ipToLong(range);

  return ((ipLong & mask) >>> 0) === ((rangeLong & mask) >>> 0);
}

/**
 * In-Memory Firewall & Ban Store
 */
class MemoryFirewallStore {
  constructor() {
    this.banned = new Map(); // ip -> { ip, reason, bannedAt, expiresAt, isPermanent, violations, meta }
    this.violations = new Map(); // ip -> [{ timestamp, type, meta }]
    this.totalBansCount = 0;
    this.totalViolationsCount = 0;
  }

  setBan(ip, record) {
    this.banned.set(ip, record);
    this.totalBansCount++;
  }

  removeBan(ip) {
    return this.banned.delete(ip);
  }

  getBan(ip) {
    const record = this.banned.get(ip);
    if (!record) return null;

    if (!record.isPermanent && record.expiresAt && Date.now() > record.expiresAt) {
      this.banned.delete(ip);
      return null;
    }

    return record;
  }

  getAllBans() {
    const now = Date.now();
    const active = [];
    for (const [ip, record] of this.banned.entries()) {
      if (!record.isPermanent && record.expiresAt && now > record.expiresAt) {
        this.banned.delete(ip);
      } else {
        active.push(record);
      }
    }
    return active;
  }

  clear() {
    this.banned.clear();
    this.violations.clear();
  }
}

/**
 * Firewall & Auto-Ban Manager
 */
class FirewallManager extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {string[]} [options.whitelist=[]] - Whitelisted IPs or CIDRs
   * @param {string[]} [options.blacklist=[]] - Static banned IPs or CIDRs
   * @param {Object} [options.autoBan] - Auto-ban configuration
   * @param {boolean} [options.autoBan.enabled=true]
   * @param {number} [options.autoBan.threshold=5] - Number of violations to trigger ban
   * @param {string|number} [options.autoBan.window='5m'] - Sliding window
   * @param {string|number} [options.autoBan.duration='1h'] - Ban duration
   */
  constructor(options = {}) {
    super();

    this.whitelist = Array.isArray(options.whitelist) ? [...options.whitelist] : [];
    this.blacklist = Array.isArray(options.blacklist) ? [...options.blacklist] : [];

    const autoBanConfig = options.autoBan || {};
    this.autoBanEnabled = autoBanConfig.enabled !== false;
    this.autoBanThreshold = autoBanConfig.threshold || 5;
    this.autoBanWindowMs = parseWindow(autoBanConfig.window || '5m');
    this.autoBanDurationMs = parseWindow(autoBanConfig.duration || '1h');

    this.store = new MemoryFirewallStore();

    // Initialize static blacklist
    for (const item of this.blacklist) {
      if (!item.includes('/')) {
        this.store.setBan(normalizeIp(item), {
          ip: normalizeIp(item),
          reason: 'static_blacklist',
          bannedAt: Date.now(),
          expiresAt: null,
          isPermanent: true,
          violations: 0,
        });
      }
    }
  }

  /**
   * Check if an IP is whitelisted
   * @param {string} ip
   * @returns {boolean}
   */
  isWhitelisted(ip) {
    const cleanIp = normalizeIp(ip);
    for (const pattern of this.whitelist) {
      if (matchIpOrCidr(cleanIp, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if an IP is banned (either static blacklist, CIDR or active dynamic ban)
   * @param {string} ip
   * @returns {{ banned: boolean, reason?: string, expiresAt?: number, isPermanent?: boolean, remainingMs?: number }}
   */
  isBanned(ip) {
    const cleanIp = normalizeIp(ip);

    // Whitelist takes absolute precedence
    if (this.isWhitelisted(cleanIp)) {
      return { banned: false };
    }

    // 1. Check static blacklist CIDR patterns
    for (const pattern of this.blacklist) {
      if (pattern.includes('/') && matchIpOrCidr(cleanIp, pattern)) {
        return {
          banned: true,
          reason: 'static_blacklist_cidr',
          isPermanent: true,
          expiresAt: null,
        };
      }
    }

    // 2. Check dynamic or exact static ban store
    const ban = this.store.getBan(cleanIp);
    if (!ban) {
      return { banned: false };
    }

    const remainingMs = ban.isPermanent ? null : Math.max(0, ban.expiresAt - Date.now());

    return {
      banned: true,
      reason: ban.reason,
      bannedAt: ban.bannedAt,
      expiresAt: ban.expiresAt,
      isPermanent: ban.isPermanent,
      remainingMs,
      violations: ban.violations,
      meta: ban.meta,
    };
  }

  /**
   * Manually or programmatically ban an IP
   * @param {string} ip
   * @param {Object} [options]
   * @param {string} [options.reason='manual_ban']
   * @param {string|number} [options.duration] - Duration string ('1h', '24h', 'permanent', 0)
   * @param {Object} [options.meta]
   * @returns {Object} Ban record
   */
  ban(ip, options = {}) {
    const cleanIp = normalizeIp(ip);

    if (this.isWhitelisted(cleanIp)) {
      throw new Error(`Cannot ban whitelisted IP: ${cleanIp}`);
    }

    const duration = options.duration;
    let expiresAt = null;
    let isPermanent = false;

    if (duration === 'permanent' || duration === 0 || duration === '0' || duration === null) {
      isPermanent = true;
    } else {
      const ms = parseWindow(duration || this.autoBanDurationMs);
      expiresAt = Date.now() + ms;
    }

    const record = {
      ip: cleanIp,
      reason: options.reason || 'manual_ban',
      bannedAt: Date.now(),
      expiresAt,
      isPermanent,
      violations: options.violations || 0,
      meta: options.meta || {},
    };

    this.store.setBan(cleanIp, record);
    this.emit('ip:banned', record);

    return record;
  }

  /**
   * Remove ban for an IP
   * @param {string} ip
   * @returns {boolean}
   */
  unban(ip) {
    const cleanIp = normalizeIp(ip);
    const removed = this.store.removeBan(cleanIp);

    // Also remove from static blacklist array if present
    const idx = this.blacklist.indexOf(cleanIp);
    if (idx !== -1) {
      this.blacklist.splice(idx, 1);
    }

    if (removed) {
      this.emit('ip:unbanned', { ip: cleanIp });
    }

    return removed;
  }

  /**
   * Record a security violation and check auto-ban threshold
   * @param {string} ip
   * @param {Object} violation
   * @param {string} violation.type - 'honeypot'|'path_traversal'|'bad_bot'|'bruteforce'|'rate_limit'
   * @param {number} [violation.weight=1]
   * @param {string} [violation.path]
   * @param {string} [violation.userAgent]
   * @returns {{ banned: boolean, count: number, autoBanned: boolean }}
   */
  recordViolation(ip, violation = {}) {
    const cleanIp = normalizeIp(ip);

    if (this.isWhitelisted(cleanIp)) {
      return { banned: false, count: 0, autoBanned: false };
    }

    this.store.totalViolationsCount++;
    const now = Date.now();
    const windowStart = now - this.autoBanWindowMs;

    let history = this.store.violations.get(cleanIp) || [];
    // Prune entries outside sliding window
    history = history.filter(v => v.timestamp >= windowStart);

    const weight = violation.weight || 1;
    for (let i = 0; i < weight; i++) {
      history.push({
        timestamp: now,
        type: violation.type || 'generic_violation',
        path: violation.path,
        userAgent: violation.userAgent,
      });
    }

    this.store.violations.set(cleanIp, history);
    const count = history.length;

    let autoBanned = false;
    if (this.autoBanEnabled && count >= this.autoBanThreshold) {
      const banRecord = this.ban(cleanIp, {
        reason: `auto_ban: threshold exceeded (${violation.type || 'violations'})`,
        duration: this.autoBanDurationMs,
        violations: count,
        meta: {
          lastPath: violation.path,
          userAgent: violation.userAgent,
        },
      });
      autoBanned = true;
      this.emit('firewall:auto_ban', banRecord);
    }

    return {
      banned: autoBanned || this.isBanned(cleanIp).banned,
      count,
      autoBanned,
    };
  }

  /**
   * List banned IPs with pagination and search
   * @param {Object} [filter]
   * @param {number} [filter.page=1]
   * @param {number} [filter.limit=25]
   * @param {string} [filter.search]
   * @param {string} [filter.reason]
   * @returns {Object}
   */
  listBanned(filter = {}) {
    const page = Math.max(1, parseInt(filter.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(filter.limit, 10) || 25));
    const search = filter.search ? String(filter.search).trim().toLowerCase() : null;
    const reasonFilter = filter.reason ? String(filter.reason).trim().toLowerCase() : null;

    let items = this.store.getAllBans();

    if (search) {
      items = items.filter(b => b.ip.toLowerCase().includes(search) || (b.reason && b.reason.toLowerCase().includes(search)));
    }

    if (reasonFilter && reasonFilter !== 'all') {
      items = items.filter(b => b.reason && b.reason.toLowerCase().includes(reasonFilter));
    }

    // Sort newest first
    items.sort((a, b) => b.bannedAt - a.bannedAt);

    const total = items.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const paginated = items.slice(offset, offset + limit);

    return {
      items: paginated,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Get overall firewall statistics
   * @returns {Object}
   */
  getStats() {
    const activeBans = this.store.getAllBans();
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const autoBans24h = activeBans.filter(b => b.bannedAt >= oneDayAgo && b.reason?.startsWith('auto_ban')).length;
    const permanentBans = activeBans.filter(b => b.isPermanent).length;

    return {
      activeBans: activeBans.length,
      permanentBans,
      autoBans24h,
      totalBans: this.store.totalBansCount,
      totalViolations: this.store.totalViolationsCount,
      whitelistCount: this.whitelist.length,
      blacklistCount: this.blacklist.length,
    };
  }
}

/**
 * Create Express middleware for Firewall enforcement
 * @param {FirewallManager} firewall
 * @returns {Function}
 */
function createFirewallMiddleware(firewall) {
  return function firewallMiddleware(req, res, next) {
    const clientIp = extractClientIp(req);
    const banInfo = firewall.isBanned(clientIp);

    if (banInfo.banned) {
      firewall.emit('firewall:blocked', { ip: clientIp, path: req.originalUrl || req.url, reason: banInfo.reason });

      res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied by security firewall.',
        reason: banInfo.reason,
      });
      return;
    }

    next();
  };
}

module.exports = {
  FirewallManager,
  MemoryFirewallStore,
  createFirewallMiddleware,
  normalizeIp,
  ipToLong,
  matchIpOrCidr,
};

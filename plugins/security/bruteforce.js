/**
 * Brute-Force & Credential Stuffing Guard
 * Zero-dependency native Node.js implementation.
 * @module plugins/security/bruteforce
 */

'use strict';

const { extractClientIp, parseWindow, formatResetSeconds } = require('../../core/rate-limit/utils');

/**
 * Default target routes subject to brute-force monitoring
 */
const DEFAULT_AUTH_ROUTES = [
  '/api/auth/login',
  '/_admin/api/auth/login',
  '/auth/login',
  '/login',
  '/api/auth/reset-password',
];

/**
 * Brute-force attempt tracker
 */
class BruteForceTracker {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxAttempts=5] - Maximum failed attempts before lockout
   * @param {string|number} [options.window='15m'] - Sliding tracking window
   * @param {string|number} [options.lockout='15m'] - Lockout duration
   * @param {boolean} [options.progressiveDelay=true] - Add artificial delay on successive failures
   * @param {number} [options.delayStepMs=200] - Milliseconds delay per failure
   */
  constructor(options = {}) {
    this.maxAttempts = options.maxAttempts || 5;
    this.windowMs = parseWindow(options.window || '15m');
    this.lockoutMs = parseWindow(options.lockout || '15m');
    this.progressiveDelay = options.progressiveDelay !== false;
    this.delayStepMs = options.delayStepMs || 200;

    this.attempts = new Map(); // ip -> { count: number, firstAttempt: number, lockedUntil: number|null }
  }

  /**
   * Check if an IP is locked out
   * @param {string} ip
   * @returns {{ locked: boolean, remainingSeconds: number, attempts: number }}
   */
  check(ip) {
    const record = this.attempts.get(ip);
    if (!record) {
      return { locked: false, remainingSeconds: 0, attempts: 0 };
    }

    const now = Date.now();

    // Check if lockout has expired
    if (record.lockedUntil) {
      if (now < record.lockedUntil) {
        const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
        return { locked: true, remainingSeconds, attempts: record.count };
      }
      // Lockout expired, reset
      this.attempts.delete(ip);
      return { locked: false, remainingSeconds: 0, attempts: 0 };
    }

    // Check if tracking window has expired
    if (now - record.firstAttempt > this.windowMs) {
      this.attempts.delete(ip);
      return { locked: false, remainingSeconds: 0, attempts: 0 };
    }

    return { locked: false, remainingSeconds: 0, attempts: record.count };
  }

  /**
   * Record a failed login attempt
   * @param {string} ip
   * @returns {{ locked: boolean, attempts: number, lockedUntil: number|null }}
   */
  recordFailure(ip) {
    const now = Date.now();
    let record = this.attempts.get(ip);

    if (!record || (now - record.firstAttempt > this.windowMs && !record.lockedUntil)) {
      record = { count: 1, firstAttempt: now, lockedUntil: null };
    } else {
      record.count++;
    }

    let locked = false;
    if (record.count >= this.maxAttempts) {
      record.lockedUntil = now + this.lockoutMs;
      locked = true;
    }

    this.attempts.set(ip, record);
    return {
      locked,
      attempts: record.count,
      lockedUntil: record.lockedUntil,
    };
  }

  /**
   * Reset attempts on successful login
   * @param {string} ip
   */
  recordSuccess(ip) {
    this.attempts.delete(ip);
  }

  /**
   * Get delay in milliseconds to apply to the request
   * @param {string} ip
   * @returns {number}
   */
  getDelayMs(ip) {
    if (!this.progressiveDelay) return 0;
    const record = this.attempts.get(ip);
    if (!record || record.count <= 1) return 0;
    return Math.min(2000, (record.count - 1) * this.delayStepMs);
  }
}

/**
 * Create Brute-Force guard middleware
 * 
 * @param {Object} [options]
 * @param {import('./firewall').FirewallManager} [options.firewall]
 * @param {import('./incident-recorder').IncidentRecorder} [options.incidentRecorder]
 * @param {string[]} [options.routes] - Target routes to monitor
 * @param {number} [options.maxAttempts=5]
 * @param {string|number} [options.window='15m']
 * @param {string|number} [options.lockout='15m']
 * @param {boolean} [options.banOnExceeded=false] - Auto-ban on firewall when brute-force threshold reached
 * @returns {Function} Express middleware
 */
function createBruteForceMiddleware(options = {}) {
  const routes = (options.routes || DEFAULT_AUTH_ROUTES).map(r => r.toLowerCase());
  const tracker = new BruteForceTracker(options);
  const { firewall, incidentRecorder, banOnExceeded = false } = options;

  return function bruteForceMiddleware(req, res, next) {
    const rawPath = (req.path || req.url || '').split('?')[0].toLowerCase();
    const isTargetRoute = routes.some(target => rawPath === target || rawPath.endsWith(target));

    if (!isTargetRoute) {
      return next();
    }

    const clientIp = extractClientIp(req);

    if (firewall && firewall.isWhitelisted(clientIp)) {
      return next();
    }

    // 1. Check if IP is currently locked out
    const status = tracker.check(clientIp);
    if (status.locked) {
      res.setHeader('Retry-After', String(status.remainingSeconds));

      if (incidentRecorder) {
        incidentRecorder.record({
          type: 'bruteforce',
          ip: clientIp,
          method: req.method,
          path: req.originalUrl || req.url,
          userAgent: req.headers?.['user-agent'],
          reason: `Brute-force lockout active (${status.attempts} failed attempts)`,
          actionTaken: 'throttled',
        });
      }

      res.status(429).json({
        error: 'Too Many Requests',
        message: 'Account authentication temporarily locked due to multiple failed attempts. Please try again later.',
        retryAfter: status.remainingSeconds,
      });
      return;
    }

    // 2. Apply progressive delay if needed
    const delayMs = tracker.getDelayMs(clientIp);
    const continueExecution = () => {
      // Intercept response finish
      res.on('finish', () => {
        const statusCode = res.statusCode;

        // HTTP 401 Unauthorized indicates failed credential check
        if (statusCode === 401) {
          const result = tracker.recordFailure(clientIp);

          if (result.locked) {
            if (incidentRecorder) {
              incidentRecorder.record({
                type: 'bruteforce',
                ip: clientIp,
                method: req.method,
                path: req.originalUrl || req.url,
                userAgent: req.headers?.['user-agent'],
                reason: `Brute-force threshold exceeded (${result.attempts} failures)`,
                actionTaken: banOnExceeded ? 'banned' : 'throttled',
              });
            }

            if (firewall) {
              if (banOnExceeded) {
                firewall.ban(clientIp, {
                  reason: 'auto_ban: brute_force threshold exceeded',
                  duration: tracker.lockoutMs,
                });
              } else {
                firewall.recordViolation(clientIp, {
                  type: 'bruteforce',
                  weight: 2,
                  path: req.originalUrl || req.url,
                });
              }
            }
          }
        } else if (statusCode >= 200 && statusCode < 300) {
          // Successful login resets tracker
          tracker.recordSuccess(clientIp);
        }
      });

      next();
    };

    if (delayMs > 0) {
      setTimeout(continueExecution, delayMs);
    } else {
      continueExecution();
    }
  };
}

module.exports = {
  createBruteForceMiddleware,
  BruteForceTracker,
  DEFAULT_AUTH_ROUTES,
};

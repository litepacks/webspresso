/**
 * Honeypot Traps, Path Traversal & Exploit Scanner Defense
 * Zero-dependency native Node.js implementation.
 * @module plugins/security/honeypot
 */

'use strict';

const { extractClientIp } = require('../../core/rate-limit/utils');

/**
 * Default Honeypot probe paths commonly targeted by automated vulnerability scanners
 */
const DEFAULT_HONEYPOT_PATHS = [
  '/.env',
  '/.env.local',
  '/.env.production',
  '/.git',
  '/.git/config',
  '/.git/HEAD',
  '/.aws/credentials',
  '/.aws/config',
  '/wp-admin',
  '/wp-login.php',
  '/xmlrpc.php',
  '/wp-content',
  '/phpmyadmin',
  '/pma',
  '/admin.php',
  '/administrator',
  '/actuator',
  '/actuator/health',
  '/actuator/env',
  '/server-status',
  '/.ds_store',
  '/config.json',
  '/web.config',
  '/id_rsa',
  '/.ssh/id_rsa',
];

/**
 * Path traversal signatures (normalized and URL-encoded variations)
 */
const PATH_TRAVERSAL_REGEX = /(?:\.\.[/\\]|\.\.%2f|\.\.%5c|%2e%2e[/\\]|%2e%2e%2f|%252e%252e|\/etc\/(?:passwd|shadow|hosts)|\/proc\/self|\b(?:win\.ini|boot\.ini)\b)/i;

/**
 * Known automated offensive security scanners / exploit tools
 */
const MALICIOUS_USER_AGENTS = [
  'sqlmap',
  'nikto',
  'acunetix',
  'havij',
  'w3af',
  'masscan',
  'zgrab',
  'nmap',
  'dirbuster',
  'gobuster',
  'wfuzz',
  'burpcollaborator',
];

/**
 * Create Honeypot & Threat Detection middleware
 * 
 * @param {Object} [options]
 * @param {import('./firewall').FirewallManager} options.firewall
 * @param {import('./incident-recorder').IncidentRecorder} options.incidentRecorder
 * @param {boolean|string[]} [options.honeypots=true] - Honeypot path list or true for defaults
 * @param {boolean} [options.detectTraversal=true] - Check for path traversal / LFI
 * @param {boolean} [options.blockBadBots=true] - Check for automated vulnerability scanners
 * @param {boolean} [options.instantBan=false] - Instantly ban IP on honeypot match (vs violation threshold)
 * @param {number} [options.violationWeight=2] - Violation weight to record in firewall
 * @param {number} [options.honeypotStatus=404] - Status code returned on honeypot hit (404 stealth or 403)
 * @returns {Function} Express middleware
 */
function createHoneypotMiddleware(options = {}) {
  const {
    firewall,
    incidentRecorder,
    honeypots = true,
    detectTraversal = true,
    blockBadBots = true,
    instantBan = false,
    violationWeight = 2,
    honeypotStatus = 404,
  } = options;

  let trapPaths = [];
  if (Array.isArray(honeypots)) {
    trapPaths = honeypots.map(p => p.toLowerCase());
  } else if (honeypots === true) {
    trapPaths = [...DEFAULT_HONEYPOT_PATHS];
  }

  const badBotsRegex = blockBadBots ? new RegExp(`\\b(?:${MALICIOUS_USER_AGENTS.join('|')})\\b`, 'i') : null;

  return function honeypotMiddleware(req, res, next) {
    const rawUrl = req.originalUrl || req.url || '/';
    const cleanPath = (req.path || rawUrl.split('?')[0] || '/').toLowerCase();
    const userAgent = req.headers?.['user-agent'] || '';
    const clientIp = extractClientIp(req);

    // Whitelist bypass
    if (firewall && firewall.isWhitelisted(clientIp)) {
      return next();
    }

    // 1. Honeypot Path Detection
    if (trapPaths.length > 0) {
      const isHoneypot = trapPaths.some(trap => cleanPath === trap || cleanPath.startsWith(`${trap}/`));
      if (isHoneypot) {
        if (incidentRecorder) {
          incidentRecorder.record({
            type: 'honeypot',
            ip: clientIp,
            method: req.method,
            path: rawUrl,
            userAgent,
            reason: `Honeypot trap accessed (${cleanPath})`,
            actionTaken: instantBan ? 'banned' : 'blocked',
          });
        }

        if (firewall) {
          if (instantBan) {
            firewall.ban(clientIp, {
              reason: `instant_ban: honeypot hit (${cleanPath})`,
              duration: firewall.autoBanDurationMs || 3600000,
            });
          } else {
            firewall.recordViolation(clientIp, {
              type: 'honeypot',
              weight: violationWeight,
              path: rawUrl,
              userAgent,
            });
          }
        }

        // Stealth response
        res.status(honeypotStatus).send(honeypotStatus === 404 ? 'Not Found' : 'Forbidden');
        return;
      }
    }

    // 2. Path Traversal & LFI Detection
    if (detectTraversal) {
      const decodedUrl = decodeURIComponentSafe(rawUrl);
      if (PATH_TRAVERSAL_REGEX.test(rawUrl) || PATH_TRAVERSAL_REGEX.test(decodedUrl)) {
        if (incidentRecorder) {
          incidentRecorder.record({
            type: 'path_traversal',
            ip: clientIp,
            method: req.method,
            path: rawUrl,
            userAgent,
            reason: 'Path traversal or LFI signature detected',
            actionTaken: 'blocked',
          });
        }

        if (firewall) {
          firewall.recordViolation(clientIp, {
            type: 'path_traversal',
            weight: violationWeight,
            path: rawUrl,
            userAgent,
          });
        }

        res.status(403).json({
          error: 'Forbidden',
          message: 'Malicious path traversal sequence detected.',
        });
        return;
      }
    }

    // 3. Automated Exploit Scanner User-Agent Detection
    if (badBotsRegex && userAgent && badBotsRegex.test(userAgent)) {
      if (incidentRecorder) {
        incidentRecorder.record({
          type: 'bad_bot',
          ip: clientIp,
          method: req.method,
          path: rawUrl,
          userAgent,
          reason: `Vulnerability scanner bot signature (${userAgent})`,
          actionTaken: 'blocked',
        });
      }

      if (firewall) {
        firewall.recordViolation(clientIp, {
          type: 'bad_bot',
          weight: violationWeight,
          path: rawUrl,
          userAgent,
        });
      }

      res.status(403).json({
        error: 'Forbidden',
        message: 'Automated vulnerability scanner rejected.',
      });
      return;
    }

    next();
  };
}

/**
 * Safe URI decoder preventing URIError crashes
 * @param {string} str
 * @returns {string}
 */
function decodeURIComponentSafe(str) {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

module.exports = {
  createHoneypotMiddleware,
  DEFAULT_HONEYPOT_PATHS,
  MALICIOUS_USER_AGENTS,
  PATH_TRAVERSAL_REGEX,
};

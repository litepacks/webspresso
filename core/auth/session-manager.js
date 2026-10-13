/**
 * Webspresso Session Revocation & Device Manager
 * Orchestrates session tracking, activity throttling, store cleanup, and event dispatching
 * @module core/auth/session-manager
 */

'use strict';

const { getClientIp, parseUserAgent } = require('./user-agent');
const { createMemorySessionTracker, createKnexSessionTracker } = require('./sessions');

class SessionManager {
  /**
   * @param {Object} options
   * @param {Object} [options.tracker] - Session tracker adapter (knex or memory)
   * @param {Object} [options.sessionStore] - Optional express-session store instance
   * @param {number} [options.touchThrottleMs=60000] - Throttle last_active_at updates (default 1 min)
   * @param {import('events').EventEmitter} [options.emitter] - AuthManager instance for event dispatching
   */
  constructor(options = {}) {
    this.tracker = options.tracker || createMemorySessionTracker();
    this.sessionStore = options.sessionStore || null;
    this.touchThrottleMs = options.touchThrottleMs ?? 60000;
    this.emitter = options.emitter || null;
    /** @type {Map<string, number>} */
    this._lastTouchMap = new Map();
  }

  /**
   * Record or update session for a user request
   * @param {string} sessionId
   * @param {string|number} userId
   * @param {Object} req - Express request
   * @returns {Promise<Object>}
   */
  async track(sessionId, userId, req) {
    if (!sessionId || !userId) return null;

    const userAgent = req?.headers?.['user-agent'] || '';
    const ip = getClientIp(req);
    const parsed = parseUserAgent(userAgent);

    const record = await this.tracker.track(sessionId, userId, {
      ip,
      userAgent,
      browser: parsed.browser,
      os: parsed.os,
      device: parsed.device,
    });

    this._lastTouchMap.set(sessionId, Date.now());

    if (this.emitter) {
      this.emitter.emit('session:created', {
        sessionId,
        userId,
        ip,
        browser: parsed.browser,
        os: parsed.os,
        device: parsed.device,
      });
    }

    return record;
  }

  /**
   * Touch session to update last_active_at with throttling
   * @param {string} sessionId
   * @returns {Promise<boolean>}
   */
  async touch(sessionId) {
    if (!sessionId) return false;

    const now = Date.now();
    const lastTouch = this._lastTouchMap.get(sessionId) || 0;

    if (now - lastTouch < this.touchThrottleMs) {
      return false; // Throttled
    }

    this._lastTouchMap.set(sessionId, now);
    return await this.tracker.touch(sessionId);
  }

  /**
   * Check if session is valid and active
   * @param {string} sessionId
   * @param {string|number} [userId]
   * @returns {Promise<boolean>}
   */
  async isSessionValid(sessionId, userId = null) {
    if (!sessionId) return false;
    return await this.tracker.isSessionValid(sessionId, userId);
  }

  /**
   * List all active sessions for a user
   * @param {string|number} userId
   * @param {string} [currentSessionId]
   * @returns {Promise<Array<Object>>}
   */
  async listSessions(userId, currentSessionId = null) {
    if (!userId) return [];
    return await this.tracker.list(userId, currentSessionId);
  }

  /**
   * Revoke a specific session
   * @param {string} sessionId
   * @param {Object} [options]
   * @param {string|number} [options.userId]
   * @param {string} [options.revokedBy]
   * @returns {Promise<boolean>}
   */
  async revokeSession(sessionId, options = {}) {
    if (!sessionId) return false;

    this._lastTouchMap.delete(sessionId);
    const success = await this.tracker.revoke(sessionId);

    // If express-session store is available, destroy physical session
    if (this.sessionStore && typeof this.sessionStore.destroy === 'function') {
      try {
        await new Promise((resolve) => this.sessionStore.destroy(sessionId, () => resolve()));
      } catch (err) {
        // Continue even if session store destroy errors
      }
    }

    if (this.emitter) {
      this.emitter.emit('session:revoked', {
        sessionId,
        userId: options.userId,
        revokedBy: options.revokedBy,
      });
    }

    return success;
  }

  /**
   * Revoke all other sessions for a user except the current one
   * @param {string|number} userId
   * @param {string} currentSessionId
   * @returns {Promise<number>} Count of revoked sessions
   */
  async revokeOtherSessions(userId, currentSessionId) {
    if (!userId) return 0;

    const count = await this.tracker.revokeOthers(userId, currentSessionId);

    if (this.emitter) {
      this.emitter.emit('sessions:revoked_others', {
        userId,
        currentSessionId,
        count,
      });
    }

    return count;
  }

  /**
   * Revoke all sessions for a user (e.g. password reset or admin security action)
   * @param {string|number} userId
   * @returns {Promise<number>} Count of revoked sessions
   */
  async revokeAllSessions(userId) {
    if (!userId) return 0;

    const count = await this.tracker.revokeAll(userId);

    if (this.emitter) {
      this.emitter.emit('sessions:revoked_all', {
        userId,
        count,
      });
    }

    return count;
  }
}

/**
 * Route handler to list active sessions for current user (GET /api/auth/sessions)
 * @param {import('./manager').AuthManager} authManager
 * @returns {Function} Express route handler
 */
function createListSessionsHandler(authManager) {
  return async function listSessionsHandler(req, res) {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const currentSessionId = req.sessionID || null;
      const sessions = await authManager.listSessions(req.user.id, currentSessionId);
      return res.json({ ok: true, sessions });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to list sessions' });
    }
  };
}

/**
 * Route handler to revoke a session (POST /api/auth/sessions/revoke)
 * @param {import('./manager').AuthManager} authManager
 * @returns {Function} Express route handler
 */
function createRevokeSessionHandler(authManager) {
  return async function revokeSessionHandler(req, res) {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { sessionId, allOthers } = req.body || {};

    try {
      if (allOthers) {
        const count = await authManager.revokeOtherSessions(req.user.id, req.sessionID);
        return res.json({ ok: true, revokedCount: count, message: 'All other sessions revoked' });
      }

      if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
      }

      // Check ownership: ensure session belongs to current user unless user is admin
      const sessions = await authManager.listSessions(req.user.id);
      const ownsSession = sessions.some((s) => s.session_id === sessionId);

      if (!ownsSession && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Cannot revoke session belonging to another user' });
      }

      await authManager.revokeSession(sessionId, { userId: req.user.id });

      // If user revoked their own current session, log them out
      if (sessionId === req.sessionID && req.auth && typeof req.auth.logout === 'function') {
        await req.auth.logout();
      }

      return res.json({ ok: true, message: 'Session revoked successfully' });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to revoke session' });
    }
  };
}

module.exports = {
  SessionManager,
  createListSessionsHandler,
  createRevokeSessionHandler,
};

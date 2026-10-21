'use strict';

/**
 * Webspresso Auth - Framework-Agnostic Request Authenticator
 * Resolves user identity from Bearer JWT header, session, or remember-me token
 * @module core/auth/authenticate
 */

/**
 * Authenticate incoming request using the AuthManager
 * Populates req.user, req.auth, req.token, req.jwtPayload
 * @param {Object} req - Request object (requires headers, cookies, session)
 * @param {Object} [res] - Response object (for remember-me cookie update)
 * @param {import('./manager').AuthManager} authManager
 * @returns {Promise<Object|null>} The authenticated user or null
 */
async function authenticateRequest(req, res, authManager) {
  if (!authManager) return null;

  // Initialize req.user as null
  req.user = null;

  // Create request-bound auth helper if method exists
  if (typeof authManager.createRequestAuth === 'function') {
    req.auth = authManager.createRequestAuth(req, res);
  }

  // 1. Check Bearer JWT token header first
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    try {
      const payload = authManager.verifyJwt(token);
      req.token = token;
      req.jwtPayload = payload;
      if (payload.id) {
        const user = await authManager.findUserById(payload.id);
        req.user = user || payload;
      } else {
        req.user = payload;
      }
      return req.user;
    } catch (jwtErr) {
      // Invalid or expired JWT token header
    }
  }

  // 2. Try to load user from session if not authenticated by JWT
  if (!req.user && req.session?.userId) {
    let isSessionValid = true;
    if (authManager.sessionManager && req.sessionID) {
      isSessionValid = await authManager.isSessionValid(req.sessionID, req.session.userId);
    }

    if (!isSessionValid) {
      delete req.session.userId;
      if (typeof req.session.destroy === 'function') {
        req.session.destroy(() => {});
      }
    } else {
      const user = await authManager.findUserById(req.session.userId);
      if (user) {
        req.user = user;
        if (req.sessionID && authManager.sessionManager) {
          authManager.touchSession(req.sessionID).catch(() => {});
        }
        return req.user;
      } else {
        delete req.session.userId;
      }
    }
  }

  // 3. If no user in session or JWT, try remember-me token
  if (!req.user && authManager.rememberTokens && typeof authManager.verifyRememberToken === 'function') {
    const user = await authManager.verifyRememberToken(req, res);
    if (user) {
      req.user = user;
      if (req.session) {
        req.session.userId = user.id;
        req.session.loggedInAt = Date.now();
      }
      if (req.sessionID && authManager.sessionManager) {
        authManager.trackSession(req.sessionID, user.id, req).catch(() => {});
      }
      return req.user;
    }
  }

  return req.user;
}

module.exports = { authenticateRequest };

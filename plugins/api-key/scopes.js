/**
 * API Key Plugin — Scope and Permission Authorization
 * @module plugins/api-key/scopes
 */

'use strict';

/**
 * Normalize scopes input into an array of string tokens
 * 
 * @param {string|string[]|null|undefined} scopes
 * @returns {string[]}
 */
function normalizeScopes(scopes) {
  if (!scopes) {
    return [];
  }

  if (Array.isArray(scopes)) {
    return scopes
      .map((s) => (typeof s === 'string' ? s.trim() : String(s).trim()))
      .filter(Boolean);
  }

  if (typeof scopes === 'string') {
    const trimmed = scopes.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((s) => String(s).trim()).filter(Boolean);
        }
      } catch (_) {
        // Fallback to comma-separated parsing
      }
    }
    return trimmed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return [];
}

/**
 * Match a granted scope against a required scope with wildcard support
 * 
 * @param {string} grantedScope - e.g. "*", "reports:*", "users:read"
 * @param {string} requiredScope - e.g. "reports:read"
 * @returns {boolean}
 */
function matchScope(grantedScope, requiredScope) {
  if (typeof grantedScope !== 'string' || typeof requiredScope !== 'string') {
    return false;
  }

  const granted = grantedScope.trim();
  const required = requiredScope.trim();

  // 1. Exact match
  if (granted === required) {
    return true;
  }

  // 2. Global wildcard
  if (granted === '*') {
    return true;
  }

  // 3. Prefix / namespace wildcard (e.g. "reports:*" matches "reports:read" or "reports:export:csv")
  if (granted.endsWith(':*')) {
    const prefix = granted.slice(0, -2);
    if (required === prefix || required.startsWith(prefix + ':')) {
      return true;
    }
  }

  return false;
}

/**
 * Check if granted scopes satisfy a single required scope
 * 
 * @param {string|string[]} grantedScopes
 * @param {string} requiredScope
 * @returns {boolean}
 */
function hasScope(grantedScopes, requiredScope) {
  const granted = normalizeScopes(grantedScopes);
  return granted.some((g) => matchScope(g, requiredScope));
}

/**
 * Check if granted scopes satisfy a list of required scopes
 * 
 * @param {string|string[]} grantedScopes
 * @param {string|string[]} requiredScopes
 * @param {boolean} [requireAll=true] - If true, all required scopes must be present. If false, any scope matches.
 * @returns {boolean}
 */
function hasRequiredScopes(grantedScopes, requiredScopes, requireAll = true) {
  const required = normalizeScopes(requiredScopes);
  if (required.length === 0) {
    return true; // No scopes required -> access permitted
  }

  const granted = normalizeScopes(grantedScopes);
  if (granted.length === 0) {
    return false; // Scopes required but none granted
  }

  if (requireAll) {
    return required.every((req) => granted.some((g) => matchScope(g, req)));
  }

  return required.some((req) => granted.some((g) => matchScope(g, req)));
}

module.exports = {
  normalizeScopes,
  matchScope,
  hasScope,
  hasRequiredScopes,
};

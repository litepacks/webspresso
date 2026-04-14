/**
 * Parse admin model CRUD paths for audit logging
 * @module plugins/audit-log/parse
 */

/**
 * Escape string for use in RegExp
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse mutation target from request path relative to admin base (no trailing slash).
 * @param {string} adminPath - e.g. /_admin
 * @param {string} method - HTTP method uppercased
 * @param {string} reqPath - req.path
 * @returns {{ action: string, resourceModel: string, resourceId: string|null }|null}
 */
function parseAdminModelAudit(adminPath, method, reqPath) {
  const base = adminPath.replace(/\/$/, '');
  if (!reqPath.startsWith(base)) {
    return null;
  }
  const rel = reqPath.slice(base.length);
  const re = /^\/api\/models\/([^/]+)\/records(?:\/([^/]+))?(?:\/(restore))?$/;
  const m = re.exec(rel);
  if (!m) {
    return null;
  }

  const resourceModel = m[1];
  const idPart = m[2];
  const isRestore = m[3] === 'restore';
  const M = method.toUpperCase();

  if (M === 'POST' && !idPart) {
    return { action: 'create', resourceModel, resourceId: null };
  }
  if (M === 'POST' && idPart && isRestore) {
    return { action: 'restore', resourceModel, resourceId: idPart };
  }
  if (M === 'PUT' && idPart && !isRestore) {
    return { action: 'update', resourceModel, resourceId: idPart };
  }
  if (M === 'DELETE' && idPart && !isRestore) {
    return { action: 'delete', resourceModel, resourceId: idPart };
  }

  return null;
}

module.exports = {
  escapeRegex,
  parseAdminModelAudit,
};

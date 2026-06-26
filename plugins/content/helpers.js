/**
 * Request-scoped template helpers for content inline editing.
 * @module plugins/content/helpers
 */

const { wrapEditable, wrapEntryBlock } = require('../../core/content');

/**
 * @param {import('express').Request} req
 * @param {string} [adminPath='/_admin']
 * @returns {boolean}
 */
function isAdminSession(req, adminPath = '/_admin') {
  return Boolean(req.session && req.session.adminUser);
}

/**
 * @param {Object} options
 * @param {string} [options.adminPath='/_admin']
 * @returns {(req: import('express').Request) => Object}
 */
function createRequestContentHelpers(options = {}) {
  const adminPath = options.adminPath || '/_admin';

  return function buildContentHelpers(req) {
    const isAdmin = isAdminSession(req);

    return {
      isAdmin() {
        return isAdmin;
      },

      adminPath() {
        return adminPath;
      },

      /**
       * @param {import('../../core/content/types').ContentEntryResult|null|undefined} entry
       */
      raw(entry) {
        return entry?.data ?? {};
      },

      /**
       * @param {unknown} value
       * @param {Object} meta
       * @param {number|string} meta.entryId
       * @param {string} meta.typeSlug
       * @param {string} [meta.field]
       * @param {string} [meta.label]
       * @param {boolean} [meta.safeHtml]
       */
      editable(value, meta = {}) {
        return wrapEditable(value, {
          ...meta,
          isAdmin,
        });
      },

      /**
       * @param {string} innerHtml
       * @param {Object} meta
       */
      block(innerHtml, meta = {}) {
        return wrapEntryBlock(innerHtml, {
          ...meta,
          isAdmin,
        });
      },
    };
  };
}

module.exports = {
  isAdminSession,
  createRequestContentHelpers,
};

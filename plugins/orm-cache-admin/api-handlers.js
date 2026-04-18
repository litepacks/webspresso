/**
 * Admin API for ORM cache metrics and purge
 * @module plugins/orm-cache-admin/api-handlers
 */

/**
 * @param {object} options
 * @param {import('../../core/orm/types').DatabaseInstance} options.db
 */
function createOrmCacheAdminHandlers({ db }) {
  function requireCache(res) {
    if (!db.cache) {
      res.status(503).json({ error: 'ORM cache is not enabled on this database' });
      return null;
    }
    return db.cache;
  }

  async function getStats(req, res) {
    try {
      const cache = requireCache(res);
      if (!cache) return;
      res.json(cache.getMetrics());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }

  async function postPurge(req, res) {
    try {
      const cache = requireCache(res);
      if (!cache) return;
      cache.purge();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }

  async function postInvalidate(req, res) {
    try {
      const cache = requireCache(res);
      if (!cache) return;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (Array.isArray(body.tags) && body.tags.length > 0) {
        cache.invalidateTags(body.tags.map(String));
        return res.json({ ok: true, mode: 'tags' });
      }
      if (typeof body.model === 'string' && body.model.trim()) {
        cache.invalidateModel(body.model.trim());
        return res.json({ ok: true, mode: 'model' });
      }
      res.status(400).json({ error: 'Provide { model: string } or { tags: string[] }' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }

  async function postResetMetrics(req, res) {
    try {
      const cache = requireCache(res);
      if (!cache) return;
      cache.resetMetrics();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }

  return {
    getStats,
    postPurge,
    postInvalidate,
    postResetMetrics,
  };
}

module.exports = { createOrmCacheAdminHandlers };

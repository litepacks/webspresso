/**
 * Content plugin API handlers
 * @module plugins/content/api-handlers
 */

/**
 * @param {Object} deps
 * @param {ReturnType<import('../../core/content/service').createContentService>} deps.contentService
 */
function createContentApiHandlers({ contentService }) {
  function sendError(res, err, status = 400) {
    const message = err?.message || 'Request failed';
    if (message.includes('not found')) {
      return res.status(404).json({ error: message });
    }
    return res.status(status).json({ error: message });
  }

  async function listTypesHandler(req, res) {
    try {
      const data = await contentService.listTypes();
      res.json({ data });
    } catch (err) {
      sendError(res, err);
    }
  }

  async function createTypeHandler(req, res) {
    try {
      const row = await contentService.createType(req.body);
      res.status(201).json({ data: row });
    } catch (err) {
      sendError(res, err);
    }
  }

  async function getTypeHandler(req, res) {
    try {
      const row = await contentService.getTypeById(req.params.id);
      if (!row) return res.status(404).json({ error: 'Content type not found' });
      res.json({ data: row });
    } catch (err) {
      sendError(res, err);
    }
  }

  async function updateTypeHandler(req, res) {
    try {
      const row = await contentService.updateType(req.params.id, req.body);
      res.json({ data: row });
    } catch (err) {
      sendError(res, err);
    }
  }

  async function deleteTypeHandler(req, res) {
    try {
      await contentService.deleteType(req.params.id);
      res.json({ success: true });
    } catch (err) {
      sendError(res, err);
    }
  }

  async function getTypeSchemaHandler(req, res) {
    try {
      const row = await contentService.getTypeBySlug(req.params.typeSlug);
      if (!row) return res.status(404).json({ error: 'Content type not found' });
      res.json({ data: { slug: row.slug, name: row.name, schema: row.schema } });
    } catch (err) {
      sendError(res, err);
    }
  }

  async function listEntriesHandler(req, res) {
    try {
      const data = await contentService.listEntries(req.params.typeSlug, {
        status: req.query.status,
        locale: req.query.locale !== undefined ? req.query.locale : undefined,
      });
      res.json({ data });
    } catch (err) {
      sendError(res, err);
    }
  }

  async function createEntryHandler(req, res) {
    try {
      const row = await contentService.createEntry(req.params.typeSlug, req.body);
      res.status(201).json({ data: row });
    } catch (err) {
      sendError(res, err);
    }
  }

  async function getEntryHandler(req, res) {
    try {
      const bundle = await contentService.getEntryById(req.params.id);
      if (!bundle) return res.status(404).json({ error: 'Content entry not found' });
      res.json({ data: bundle.entry, type: bundle.type });
    } catch (err) {
      sendError(res, err);
    }
  }

  async function updateEntryHandler(req, res) {
    try {
      const row = await contentService.updateEntry(req.params.id, req.body);
      res.json({ data: row });
    } catch (err) {
      sendError(res, err);
    }
  }

  async function deleteEntryHandler(req, res) {
    try {
      await contentService.deleteEntry(req.params.id);
      res.json({ success: true });
    } catch (err) {
      sendError(res, err);
    }
  }

  async function publicGetEntryHandler(req, res) {
    try {
      const result = await contentService.getEntry(req.params.typeSlug, req.params.entrySlug, {
        locale: req.query.locale ?? null,
      });
      if (!result) return res.status(404).json({ error: 'Content not found' });
      res.json({
        type: result.meta.typeSlug,
        slug: result.meta.slug,
        data: result.data,
        meta: result.meta,
      });
    } catch (err) {
      sendError(res, err);
    }
  }

  return {
    listTypesHandler,
    createTypeHandler,
    getTypeHandler,
    updateTypeHandler,
    deleteTypeHandler,
    getTypeSchemaHandler,
    listEntriesHandler,
    createEntryHandler,
    getEntryHandler,
    updateEntryHandler,
    deleteEntryHandler,
    publicGetEntryHandler,
  };
}

module.exports = { createContentApiHandlers };

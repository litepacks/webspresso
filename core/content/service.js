/**
 * Content service — CRUD for content types and entries.
 * @module core/content/service
 */

const { isValidSlug, parseContentTypeSchema, validateEntryData } = require('./schema');
const { createContentCache } = require('./cache');

/**
 * @param {import('../orm').Database} db
 * @param {Object} [options]
 * @param {number|null} [options.cacheTtlMs] - null = in-memory until write invalidation
 * @param {(html: string) => string} [options.sanitizeRichHtml]
 */
function createContentService(db, options = {}) {
  if (!db) {
    throw new Error('createContentService requires a database instance');
  }

  const TypeRepo = () => db.getRepository('ContentType');
  const EntryRepo = () => db.getRepository('ContentEntry');
  const cache = createContentCache(
    options.cacheTtlMs !== undefined ? options.cacheTtlMs : null
  );
  const sanitizeRichHtml = options.sanitizeRichHtml;

  function entryCacheKey(typeSlug, entrySlug, locale, includeDraft) {
    return `entry:${typeSlug}:${entrySlug}:${locale ?? ''}:${includeDraft ? 'all' : 'pub'}`;
  }

  function invalidateType(typeSlug, typeId) {
    if (typeSlug) {
      cache.invalidatePrefix(`entry:${typeSlug}:`);
      cache.invalidatePrefix(`entries:${typeSlug}:`);
      cache.del(`type:slug:${typeSlug}`);
    }
    if (typeId != null) {
      cache.del(`type:id:${typeId}`);
    }
    cache.invalidatePrefix('types:');
  }

  function invalidateEntry(entry, type) {
    if (entry?.id != null) {
      cache.del(`entry:id:${entry.id}`);
    }
    if (type?.slug && entry?.slug != null) {
      cache.invalidatePrefix(`entry:${type.slug}:${entry.slug}:`);
    }
    if (type?.slug) {
      cache.invalidatePrefix(`entries:${type.slug}:`);
    }
  }

  function cacheTypeRow(row) {
    if (!row) return;
    cache.set(`type:slug:${row.slug}`, row);
    cache.set(`type:id:${row.id}`, row);
  }

  /**
   * @returns {Promise<import('./types').ContentTypeRecord[]>}
   */
  async function listTypes() {
    const cached = cache.get('types:all');
    if (cached) return cached;

    const rows = await db.query('ContentType').orderBy('name', 'asc').list();
    cache.set('types:all', rows);
    for (const row of rows) {
      cacheTypeRow(row);
    }
    return rows;
  }

  /**
   * @param {number|string} id
   */
  async function getTypeById(id) {
    const key = `type:id:${id}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const row = await TypeRepo().findById(id);
    cacheTypeRow(row);
    return row;
  }

  /**
   * @param {string} slug
   */
  async function getTypeBySlug(slug) {
    const key = `type:slug:${slug}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const row = await TypeRepo().findOne({ slug });
    cacheTypeRow(row);
    return row;
  }

  /**
   * @param {Object} input
   * @param {string} input.slug
   * @param {string} input.name
   * @param {string} [input.description]
   * @param {import('./types').ContentTypeSchema} input.schema
   * @param {Object} [input.settings]
   */
  async function createType(input) {
    if (!isValidSlug(input.slug)) {
      throw new Error('Invalid content type slug');
    }
    const schema = parseContentTypeSchema(input.schema);
    const existing = await getTypeBySlug(input.slug);
    if (existing) {
      throw new Error(`Content type "${input.slug}" already exists`);
    }

    const row = await TypeRepo().create({
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      schema,
      settings: input.settings ?? null,
    });

    cache.invalidateAll();
    return row;
  }

  /**
   * @param {number|string} id
   * @param {Object} input
   */
  async function updateType(id, input) {
    const existing = await getTypeById(id);
    if (!existing) {
      throw new Error('Content type not found');
    }

    /** @type {Record<string, unknown>} */
    const patch = {};

    if (input.slug !== undefined) {
      if (!isValidSlug(input.slug)) {
        throw new Error('Invalid content type slug');
      }
      if (input.slug !== existing.slug) {
        const conflict = await getTypeBySlug(input.slug);
        if (conflict) {
          throw new Error(`Content type "${input.slug}" already exists`);
        }
      }
      patch.slug = input.slug;
    }
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.settings !== undefined) patch.settings = input.settings;
    if (input.schema !== undefined) {
      patch.schema = parseContentTypeSchema(input.schema);
    }

    const row = await TypeRepo().update(id, patch);
    invalidateType(existing.slug, existing.id);
    if (patch.slug && patch.slug !== existing.slug) {
      invalidateType(String(patch.slug), existing.id);
    }
    return row;
  }

  /**
   * @param {number|string} id
   */
  async function deleteType(id) {
    const existing = await getTypeById(id);
    if (!existing) {
      throw new Error('Content type not found');
    }

    const entries = await db.query('ContentEntry').where('content_type_id', existing.id).list();
    for (const entry of entries) {
      invalidateEntry(entry, existing);
      await EntryRepo().delete(entry.id);
    }

    await TypeRepo().delete(id);
    invalidateType(existing.slug, existing.id);
    return { success: true };
  }

  /**
   * @param {string} typeSlug
   * @param {Object} [filters]
   */
  async function listEntries(typeSlug, filters = {}) {
    const status = filters.status ?? '';
    const localeKey = filters.locale !== undefined ? String(filters.locale) : '';
    const listKey = `entries:${typeSlug}:${status}:${localeKey}`;
    const cached = cache.get(listKey);
    if (cached) return cached;

    const type = await getTypeBySlug(typeSlug);
    if (!type) {
      throw new Error(`Content type "${typeSlug}" not found`);
    }

    /** @type {Record<string, unknown>} */
    const where = { content_type_id: type.id };
    if (filters.status) where.status = filters.status;
    if (filters.locale !== undefined) where.locale = filters.locale;

    const rows = await db.query('ContentEntry')
      .where(where)
      .orderBy('updated_at', 'desc')
      .list();

    cache.set(listKey, rows);
    return rows;
  }

  /**
   * @param {string} typeSlug
   * @param {string} entrySlug
   * @param {import('./types').GetEntryOptions} [opts]
   * @returns {Promise<import('./types').ContentEntryResult|null>}
   */
  async function getEntry(typeSlug, entrySlug, opts = {}) {
    const locale = opts.locale ?? null;
    const includeDraft = Boolean(opts.includeDraft);
    const key = entryCacheKey(typeSlug, entrySlug, locale, includeDraft);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const type = await getTypeBySlug(typeSlug);
    if (!type) return null;

    /** @type {Record<string, unknown>} */
    const where = {
      content_type_id: type.id,
      slug: entrySlug,
      locale,
    };

    if (!includeDraft) {
      where.status = 'published';
    }

    const entry = await EntryRepo().findOne(where);
    if (!entry) {
      cache.set(key, null);
      return null;
    }

    const result = {
      data: entry.data || {},
      meta: {
        id: entry.id,
        slug: entry.slug,
        title: entry.title,
        status: entry.status,
        locale: entry.locale,
        revision: entry.revision,
        contentTypeId: type.id,
        typeSlug: type.slug,
        updatedAt: entry.updated_at,
      },
      type,
    };

    cache.set(key, result);
    cache.set(`entry:id:${entry.id}`, { entry, type });
    return result;
  }

  /**
   * @param {number|string} id
   */
  async function getEntryById(id) {
    const key = `entry:id:${id}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const entry = await EntryRepo().findById(id);
    if (!entry) return null;

    const type = await getTypeById(entry.content_type_id);
    const bundle = { entry, type };
    cache.set(key, bundle);
    return bundle;
  }

  /**
   * @param {string} typeSlug
   * @param {Object} input
   */
  async function createEntry(typeSlug, input) {
    const type = await getTypeBySlug(typeSlug);
    if (!type) {
      throw new Error(`Content type "${typeSlug}" not found`);
    }
    if (!isValidSlug(input.slug)) {
      throw new Error('Invalid entry slug');
    }

    const locale = input.locale ?? null;
    const existing = await EntryRepo().findOne({
      content_type_id: type.id,
      slug: input.slug,
      locale,
    });
    if (existing) {
      throw new Error(`Entry "${input.slug}" already exists for this content type`);
    }

    const data = validateEntryData(type.schema, input.data || {}, { sanitizeRichHtml });

    const row = await EntryRepo().create({
      content_type_id: type.id,
      slug: input.slug,
      title: input.title ?? null,
      data,
      status: input.status === 'draft' ? 'draft' : 'published',
      locale,
      revision: 1,
    });

    invalidateType(type.slug, type.id);
    return row;
  }

  /**
   * @param {number|string} id
   * @param {Object} input
   */
  async function updateEntry(id, input) {
    const bundle = await getEntryById(id);
    if (!bundle) {
      throw new Error('Content entry not found');
    }
    const { entry, type } = bundle;

    /** @type {Record<string, unknown>} */
    const patch = {};

    if (input.slug !== undefined) {
      if (!isValidSlug(input.slug)) {
        throw new Error('Invalid entry slug');
      }
      patch.slug = input.slug;
    }
    if (input.title !== undefined) patch.title = input.title;
    if (input.status !== undefined) {
      patch.status = input.status === 'draft' ? 'draft' : 'published';
    }
    if (input.locale !== undefined) patch.locale = input.locale;
    if (input.data !== undefined && type) {
      patch.data = validateEntryData(type.schema, input.data, { sanitizeRichHtml });
    }

    patch.revision = (entry.revision || 1) + 1;

    const row = await EntryRepo().update(id, patch);
    invalidateEntry(entry, type);
    if (type) invalidateType(type.slug, type.id);
    return row;
  }

  /**
   * @param {number|string} id
   */
  async function deleteEntry(id) {
    const bundle = await getEntryById(id);
    if (!bundle) {
      throw new Error('Content entry not found');
    }

    await EntryRepo().delete(id);
    invalidateEntry(bundle.entry, bundle.type);
    if (bundle.type) invalidateType(bundle.type.slug, bundle.type.id);
    return { success: true };
  }

  return {
    listTypes,
    getTypeById,
    getTypeBySlug,
    createType,
    updateType,
    deleteType,
    listEntries,
    getEntry,
    getEntryById,
    createEntry,
    updateEntry,
    deleteEntry,
  };
}

module.exports = { createContentService };

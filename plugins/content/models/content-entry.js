/**
 * ContentEntry model — content entries with JSON field data.
 * @module plugins/content/models/content-entry
 */

const { defineModel } = require('../../../core/orm/model');
const { zdb } = require('../../../core/orm');

const ContentEntrySchema = zdb.schema({
  id: zdb.id(),
  content_type_id: zdb.foreignKey('content_types', { index: true }),
  slug: zdb.string({ maxLength: 128, index: true }),
  title: zdb.string({ maxLength: 255, nullable: true }),
  data: zdb.json(),
  status: zdb.enum(['published', 'draft'], { default: 'published', index: true }),
  locale: zdb.string({ maxLength: 16, nullable: true, index: true }),
  revision: zdb.integer({ default: 1 }),
  created_at: zdb.timestamp({ auto: 'create' }),
  updated_at: zdb.timestamp({ auto: 'update' }),
});

/**
 * @returns {import('../../../core/orm/types').ModelDefinition}
 */
function createContentEntryModel() {
  return defineModel({
    name: 'ContentEntry',
    table: 'content_entries',
    schema: ContentEntrySchema,
    scopes: { timestamps: true },
    admin: { enabled: false },
    relations: {
      contentType: {
        type: 'belongsTo',
        model: () => require('../../../core/orm/model').getModel('ContentType'),
        foreignKey: 'content_type_id',
      },
    },
  });
}

module.exports = {
  createContentEntryModel,
  ContentEntrySchema,
};

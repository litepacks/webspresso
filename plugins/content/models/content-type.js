/**
 * ContentType model — schema-driven content type definitions.
 * @module plugins/content/models/content-type
 */

const { defineModel } = require('../../../core/orm/model');
const { zdb } = require('../../../core/orm');

const ContentTypeSchema = zdb.schema({
  id: zdb.id(),
  slug: zdb.string({ unique: true, maxLength: 128, index: true }),
  name: zdb.string({ maxLength: 255 }),
  description: zdb.text({ nullable: true }),
  schema: zdb.json(),
  settings: zdb.json({ nullable: true }),
  created_at: zdb.timestamp({ auto: 'create' }),
  updated_at: zdb.timestamp({ auto: 'update' }),
});

/**
 * @returns {import('../../../core/orm/types').ModelDefinition}
 */
function createContentTypeModel() {
  return defineModel({
    name: 'ContentType',
    table: 'content_types',
    schema: ContentTypeSchema,
    scopes: { timestamps: true },
    admin: { enabled: false },
  });
}

module.exports = {
  createContentTypeModel,
  ContentTypeSchema,
};

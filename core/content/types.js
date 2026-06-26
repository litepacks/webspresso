/**
 * @typedef {'text'|'textarea'|'rich-text'|'number'|'boolean'|'image'|'url'|'date'|'select'|'repeater'} ContentFieldType
 */

/**
 * @typedef {Object} ContentFieldDefinition
 * @property {string} name
 * @property {ContentFieldType} type
 * @property {string} [label]
 * @property {boolean} [required]
 * @property {string[]} [options] - for select
 * @property {ContentFieldDefinition[]} [fields] - for repeater
 */

/**
 * @typedef {Object} ContentTypeSchema
 * @property {ContentFieldDefinition[]} fields
 */

/**
 * @typedef {Object} ContentTypeRecord
 * @property {number} id
 * @property {string} slug
 * @property {string} name
 * @property {string|null} [description]
 * @property {ContentTypeSchema} schema
 * @property {Object|null} [settings]
 * @property {string} [created_at]
 * @property {string} [updated_at]
 */

/**
 * @typedef {Object} ContentEntryRecord
 * @property {number} id
 * @property {number} content_type_id
 * @property {string} slug
 * @property {string|null} [title]
 * @property {Record<string, unknown>} data
 * @property {'published'|'draft'} status
 * @property {string|null} [locale]
 * @property {number} [revision]
 * @property {string} [created_at]
 * @property {string} [updated_at]
 */

/**
 * @typedef {Object} ContentEntryResult
 * @property {Record<string, unknown>} data
 * @property {Object} meta
 * @property {ContentTypeRecord|null} [type]
 */

/**
 * @typedef {Object} GetEntryOptions
 * @property {string|null} [locale]
 * @property {boolean} [includeDraft]
 */

module.exports = {};

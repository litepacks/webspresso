/**
 * Field Renderer Registry
 * Registry for field renderer components
 */

const basicRenderers = require('./basic');
const arrayRenderer = require('./array');
const jsonRenderer = require('./json');
const richTextRenderer = require('./rich-text');
const fileUploadRenderer = require('./file-upload');
const relationRenderers = require('./relations');

/**
 * Field renderer registry
 */
const registry = new Map();

/**
 * Register a field renderer
 * @param {string} type - Field type (e.g., 'string', 'integer', 'rich-text')
 * @param {Function} component - Mithril component function
 */
function registerFieldRenderer(type, component) {
  registry.set(type, component);
}

/**
 * Get field renderer for a column
 * @param {Object} columnMeta - Column metadata
 * @param {Object} modelMeta - Model metadata (for custom fields)
 * @returns {Function|null} Mithril component or null
 */
function getFieldRenderer(columnMeta, modelMeta = {}) {
  const { name, type, customField } = columnMeta;
  
  // Check for custom field first
  if (customField && customField.type) {
    const customRenderer = registry.get(customField.type);
    if (customRenderer) {
      return customRenderer;
    }
  }
  
  // Check for standard type
  const standardRenderer = registry.get(type);
  if (standardRenderer) {
    return standardRenderer;
  }
  
  // Fallback to text
  return registry.get('text') || registry.get('string');
}

/**
 * Initialize default renderers
 */
function initializeDefaultRenderers() {
  // Basic types
  registerFieldRenderer('string', basicRenderers.TextField);
  registerFieldRenderer('text', basicRenderers.TextAreaField);
  registerFieldRenderer('integer', basicRenderers.NumberField);
  registerFieldRenderer('bigint', basicRenderers.NumberField);
  registerFieldRenderer('float', basicRenderers.NumberField);
  registerFieldRenderer('decimal', basicRenderers.NumberField);
  registerFieldRenderer('boolean', basicRenderers.BooleanField);
  registerFieldRenderer('date', basicRenderers.DateField);
  registerFieldRenderer('datetime', basicRenderers.DateTimeField);
  registerFieldRenderer('timestamp', basicRenderers.DateTimeField);
  registerFieldRenderer('enum', basicRenderers.SelectField);
  registerFieldRenderer('uuid', basicRenderers.TextField);
  registerFieldRenderer('nanoid', basicRenderers.TextField);
  registerFieldRenderer('id', basicRenderers.NumberField);
  
  // Complex types
  registerFieldRenderer('array', arrayRenderer.ArrayField);
  registerFieldRenderer('json', jsonRenderer.JsonField);
  
  // Custom field types
  registerFieldRenderer('rich-text', richTextRenderer.RichTextField);
  registerFieldRenderer('file-upload', fileUploadRenderer.FileUploadField);
  registerFieldRenderer('file', fileUploadRenderer.FileUploadField);
  
  // Relation types
  registerFieldRenderer('belongsTo', relationRenderers.BelongsToField);
  registerFieldRenderer('hasMany', relationRenderers.HasManyField);
}

// Initialize on load
initializeDefaultRenderers();

module.exports = {
  registerFieldRenderer,
  getFieldRenderer,
  registry,
};

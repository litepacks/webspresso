/**
 * Zod schema validation for content frontmatter.
 */

/**
 * @param {import('./index').ContentItem} item
 * @param {import('./config').CollectionConfig & { name: string }} collCfg
 * @param {import('./config').ContentResolvedConfig} config
 * @returns {{ errors: string[] }}
 */
function validateContentItem(item, collCfg, config) {
  const errors = [];

  if (!item.title) {
    errors.push('missing title');
  }

  const schema = collCfg.schema;
  if (schema && typeof schema.safeParse === 'function') {
    const payload = {
      title: item.title,
      description: item.description,
      date: item.date,
      tags: item.tags,
      slug: item.slug,
      draft: item.draft,
    };
    const result = schema.safeParse(payload);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push(`${issue.path.join('.')}: ${issue.message}`);
      }
    }
  }

  return { errors };
}

class ContentValidationError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'ContentValidationError';
  }
}

module.exports = {
  validateContentItem,
  ContentValidationError,
};

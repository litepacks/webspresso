/**
 * Route config for /tools
 * Demonstrates load() function for SSR data fetching
 */

// Sample tools data (in production, this could come from a database)
const toolsData = [
  {
    slug: 'json-formatter',
    name: 'JSON Formatter',
    description: 'Format and validate JSON data with syntax highlighting.',
    icon: '📋',
    color: 'blue'
  },
  {
    slug: 'base64-encoder',
    name: 'Base64 Encoder',
    description: 'Encode and decode Base64 strings easily.',
    icon: '🔐',
    color: 'purple'
  },
  {
    slug: 'url-shortener',
    name: 'URL Shortener',
    description: 'Create short, memorable links for any URL.',
    icon: '🔗',
    color: 'green'
  },
  {
    slug: 'color-picker',
    name: 'Color Picker',
    description: 'Pick colors and get HEX, RGB, and HSL values.',
    icon: '🎨',
    color: 'pink'
  },
  {
    slug: 'markdown-preview',
    name: 'Markdown Preview',
    description: 'Write and preview Markdown in real-time.',
    icon: '📝',
    color: 'orange'
  },
  {
    slug: 'uuid-generator',
    name: 'UUID Generator',
    description: 'Generate unique UUIDs v4 with one click.',
    icon: '🆔',
    color: 'cyan'
  }
];

module.exports = {
  /**
   * Load data for the page
   * @param {Object} req - Express request
   * @param {Object} ctx - Route context
   * @returns {Object} Data to pass to the template
   */
  async load(req, ctx) {
    // Simulate async data fetching
    // In production, this could be: const tools = await db.tools.findAll();
    return {
      tools: toolsData
    };
  },

  /**
   * Override meta tags for this page
   * @param {Object} req - Express request
   * @param {Object} ctx - Route context
   * @returns {Object} Meta tags
   */
  meta(req, ctx) {
    return {
      title: ctx.t('tools.meta.title') || 'Developer Tools - Webspresso',
      description: ctx.t('tools.meta.description') || 'A collection of useful developer tools to boost your productivity.'
    };
  }
};



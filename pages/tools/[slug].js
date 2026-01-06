/**
 * Route config for /tools/:slug
 * Demonstrates dynamic route params and load() function
 */

// Same tools data (in production, share via a service/model)
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
   * Load data for the dynamic tool page
   * @param {Object} req - Express request
   * @param {Object} ctx - Route context
   * @returns {Object} Data to pass to the template
   */
  async load(req, ctx) {
    const { slug } = req.params;
    
    // Find the tool by slug
    const tool = toolsData.find(t => t.slug === slug);
    
    if (!tool) {
      // Tool not found - in a real app you might want to throw a 404
      return {
        tool: null,
        relatedTools: []
      };
    }
    
    // Get related tools (exclude current)
    const relatedTools = toolsData
      .filter(t => t.slug !== slug)
      .slice(0, 3);
    
    return {
      tool,
      relatedTools
    };
  },

  /**
   * Dynamic meta tags based on the tool
   * @param {Object} req - Express request
   * @param {Object} ctx - Route context
   * @returns {Object} Meta tags
   */
  meta(req, ctx) {
    const tool = ctx.data.tool;
    
    if (!tool) {
      return {
        title: 'Tool Not Found - Webspresso',
        description: 'The requested tool could not be found.',
        indexable: false
      };
    }
    
    return {
      title: `${tool.name} - Webspresso Tools`,
      description: tool.description
    };
  },

  /**
   * Optional hooks for this route
   */
  hooks: {
    // Example: Log when tool page is accessed
    async afterLoad(ctx) {
      if (ctx.data.tool) {
        console.log(`Tool accessed: ${ctx.data.tool.slug}`);
      }
    }
  }
};



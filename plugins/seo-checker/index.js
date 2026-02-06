/**
 * Webspresso SEO Checker Plugin
 * Client-side SEO analysis tool integrated with dev toolbar
 * Inspired by django-check-seo
 */

const { generatePanelStyles, generatePanelHtml } = require('./panel');
const analyzerScript = require('./analyzer');
const { defaultSettings, checkDefinitions } = require('./checks');

/**
 * Create the SEO Checker plugin
 * @param {Object} options - Plugin options
 * @param {boolean} options.enabled - Force enable/disable (default: auto based on NODE_ENV)
 * @param {Object} options.settings - SEO check settings
 */
function seoCheckerPlugin(options = {}) {
  const {
    enabled,
    settings = {}
  } = options;

  // Merge settings with defaults
  const mergedSettings = { ...defaultSettings, ...settings };

  // Determine if enabled (default: only in development)
  const isEnabled = enabled !== undefined
    ? enabled
    : process.env.NODE_ENV !== 'production';

  return {
    name: 'seo-checker',
    version: '1.0.0',
    description: 'Client-side SEO analysis tool for development',

    /**
     * Called when plugin is initialized
     */
    onInit(ctx) {
      if (!isEnabled) return;

      // Register dev link in toolbar
      ctx.registerDevLink({
        name: 'SEO Check',
        path: '#seo-checker',
        icon: '🔍',
        description: 'Analyze page SEO'
      });
    },

    /**
     * Called before page render - inject SEO checker panel
     */
    onBeforeRender(ctx) {
      if (!isEnabled) return;

      // Inject panel styles
      ctx.injectHead(generatePanelStyles(), { priority: 100 });

      // Inject panel HTML and analyzer script
      ctx.injectBody(`
        ${generatePanelHtml(checkDefinitions)}
        <script>
          window.__SEO_CHECKER_SETTINGS__ = ${JSON.stringify(mergedSettings)};
          window.__SEO_CHECKER_CHECKS__ = ${JSON.stringify(checkDefinitions)};
        </script>
        <script>${analyzerScript}</script>
      `);
    },

    /**
     * Plugin API
     */
    api: {
      /**
       * Get current settings
       */
      getSettings() {
        return { ...mergedSettings };
      },

      /**
       * Get check definitions
       */
      getChecks() {
        return [...checkDefinitions];
      },

      /**
       * Check if enabled
       */
      isEnabled() {
        return isEnabled;
      }
    }
  };
}

module.exports = seoCheckerPlugin;

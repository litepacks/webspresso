/**
 * Webspresso Dashboard Plugin
 * Development dashboard for monitoring routes, plugins, and configuration
 * Uses Mithril.js for the SPA interface
 */

const styles = require('./styles');
const appScript = require('./app');

/**
 * Filter sensitive environment variables
 */
function filterSensitiveEnv(env) {
  const sensitiveKeys = ['SECRET', 'PASSWORD', 'KEY', 'TOKEN', 'CREDENTIAL', 'PRIVATE'];
  const filtered = {};
  
  for (const [key, value] of Object.entries(env)) {
    const isSensitive = sensitiveKeys.some(s => key.toUpperCase().includes(s));
    filtered[key] = isSensitive ? '••••••••' : value;
  }
  
  return filtered;
}

/**
 * Generate the dashboard HTML
 */
function generateDashboardHtml(data) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Webspresso Dashboard</title>
  <script src="https://unpkg.com/mithril/mithril.js"></script>
  <style>${styles}</style>
</head>
<body>
  <div id="app"></div>
  <script>
    window.__DASHBOARD_DATA__ = ${JSON.stringify(data)};
  </script>
  <script>${appScript}</script>
</body>
</html>`;
}

/**
 * Create the dashboard plugin
 * @param {Object} options - Plugin options
 * @param {string} options.path - Dashboard path (default: '/_webspresso')
 * @param {boolean} options.enabled - Force enable/disable (default: auto based on NODE_ENV)
 */
function dashboardPlugin(options = {}) {
  const {
    path: dashboardPath = '/_webspresso',
    enabled
  } = options;
  
  // Determine if enabled (default: only in development)
  const isEnabled = enabled !== undefined 
    ? enabled 
    : process.env.NODE_ENV !== 'production';
  
  return {
    name: 'dashboard',
    version: '1.0.0',
    description: 'Development dashboard for monitoring routes and configuration',
    
    /**
     * Called after routes are mounted
     */
    onRoutesReady(ctx) {
      // Skip if disabled
      if (!isEnabled) {
        return;
      }
      
      const { app, routes, options: appOptions } = ctx;
      
      // Collect plugin info
      const pluginManager = ctx.pluginManager || (appOptions && appOptions.pluginManager);
      const plugins = [];
      
      // Get plugins from plugin manager if available
      if (pluginManager && pluginManager.plugins) {
        for (const [name, plugin] of pluginManager.plugins) {
          plugins.push({
            name: plugin.name || name,
            version: plugin.version || '0.0.0',
            description: plugin.description || ''
          });
        }
      }
      
      // Build config data
      const config = {
        env: filterSensitiveEnv({
          NODE_ENV: process.env.NODE_ENV || 'development',
          PORT: process.env.PORT || '3000',
          BASE_URL: process.env.BASE_URL || 'http://localhost:3000'
        }),
        i18n: {
          defaultLocale: process.env.DEFAULT_LOCALE || 'en',
          supportedLocales: (process.env.SUPPORTED_LOCALES || 'en').split(',')
        },
        server: {
          port: process.env.PORT || '3000',
          baseUrl: process.env.BASE_URL || 'http://localhost:3000'
        }
      };
      
      // Dashboard HTML endpoint
      ctx.addRoute('get', dashboardPath, (req, res) => {
        const data = { routes, plugins, config };
        res.type('text/html');
        res.send(generateDashboardHtml(data));
      });
      
      // JSON API endpoints
      ctx.addRoute('get', dashboardPath + '/api/routes', (req, res) => {
        res.json(routes);
      });
      
      ctx.addRoute('get', dashboardPath + '/api/plugins', (req, res) => {
        res.json(plugins);
      });
      
      ctx.addRoute('get', dashboardPath + '/api/config', (req, res) => {
        res.json(config);
      });
      
      // Log dashboard URL
      console.log(`\n📊 Dashboard available at: http://localhost:${process.env.PORT || 3000}${dashboardPath}\n`);
    }
  };
}

module.exports = dashboardPlugin;



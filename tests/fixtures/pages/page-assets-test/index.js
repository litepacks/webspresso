/**
 * Fixture: per-route stylesheets / scripts when createApp({ pageAssets: true })
 */
module.exports = {
  async load() {
    return {
      stylesheets: ['/page-assets-extra.css'],
      scripts: [{ src: '/page-assets-extra.js', defer: true }],
    };
  },
};

const { definePlugin } = require('../plugin');

module.exports = definePlugin({
  name: 'seo-plugin',

  events(app) {
    app.events.on('orm.post.afterCreate', async () => {
      console.log('[plugin] SEO update triggered');
    });
  },

  views() {
    return {
      namespace: 'seo',
      layouts: {
        main: '<html><body><div class="wrap">{{ content }}</div></body></html>',
      },
      pages: {
        home: '<h1>{{ title }}</h1><p>Welcome</p>',
      },
      partials: {
        badge: '<span class="badge">{{ label }}</span>',
      },
    };
  },
});

const path = require('path');
const { createApp, sitemapPlugin } = require('webspresso');

const { app } = createApp({
  pagesDir: path.join(__dirname, 'pages'),
  viewsDir: path.join(__dirname, 'views'),
  content: {
    enabled: true,
    collections: {
      blog: {
        route: '/blog/:slug',
        indexRoute: '/blog',
        layout: 'blog-post',
      },
    },
  },
  plugins: [
    sitemapPlugin({
      hostname: process.env.BASE_URL || 'http://localhost:3000',
      robots: true,
    }),
  ],
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Content blog example http://localhost:${port}`);
});

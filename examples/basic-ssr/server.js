const path = require('path');
const { createApp } = require('../../');

const { app } = createApp({
  pagesDir: path.join(__dirname, 'pages'),
  viewsDir: path.join(__dirname, 'views'),
  publicDir: path.join(__dirname, 'public'),
  server: {
    shutdown: { enabled: true, timeout: 5000 },
    compression: true,
  },
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Basic SSR example listening at http://localhost:${PORT}`);
  });
}

module.exports = app;

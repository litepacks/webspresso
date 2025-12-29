require('dotenv').config();
const { createApp } = require('webspresso');
const path = require('path');

const { app } = createApp({
  pagesDir: path.join(__dirname, 'pages'),
  viewsDir: path.join(__dirname, 'views'),
  publicDir: path.join(__dirname, 'public')
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

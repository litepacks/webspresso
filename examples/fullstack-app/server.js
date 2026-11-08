'use strict';

const path = require('path');
const { createFullstackApp } = require('./app');

const PORT = Number(process.env.PORT || 7332);

async function main() {
  const { app, close } = await createFullstackApp({
    filename: process.env.DB_FILE || path.join(__dirname, 'data.sqlite'),
  });

  const server = app.listen(PORT, () => {
    console.log(`Fullstack example listening at http://localhost:${PORT}`);
    console.log('Demo login: admin@example.com / secret-password  →  POST /api/auth/login');
  });

  const stop = () => server.close(() => close().finally(() => process.exit(0)));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { createFullstackApp };


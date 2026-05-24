module.exports = {
  apps: [
    {
      name: 'webspresso',
      script: '.webspresso/server/index.mjs',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      max_memory_restart: '512M',
      watch: false,
    },
  ],
};

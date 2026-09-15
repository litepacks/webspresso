const { defineApi } = require('../../../../../index');

module.exports = defineApi({
  handler: async () => ({ status: 'ok', uptime: process.uptime() }),
});

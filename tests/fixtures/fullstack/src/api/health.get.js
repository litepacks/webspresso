const { defineApi } = require('../../../../../src/api/define-api');

module.exports = defineApi({
  handler: async () => ({ status: 'ok', uptime: process.uptime() }),
});

const { defineApi } = require('../../../../../../../src/api/define-api');

module.exports = defineApi({
  middleware: ['authGuard'],
  handler: async (req) => {
    return {
      user: req.user,
    };
  },
});

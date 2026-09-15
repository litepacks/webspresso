const { defineApi } = require('../../../../../../../index');

module.exports = defineApi({
  middleware: ['authGuard'],
  handler: async (req) => {
    return {
      user: req.user,
    };
  },
});

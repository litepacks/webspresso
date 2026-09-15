const { definePage } = require('../../src/pages/define-page');

module.exports = definePage({
  load: async (ctx) => {
    return ctx.redirect('/new-path', 301);
  },
});

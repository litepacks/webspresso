const { definePage } = require('../../../../../../../src/pages/define-page');

module.exports = definePage({
  load: async () => ({ page: 'Login Page' }),
  render: (data) => `<main><h1>${data.page}</h1></main>`,
});

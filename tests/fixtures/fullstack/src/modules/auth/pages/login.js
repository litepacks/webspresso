const { definePage } = require('../../../../../../../index');

module.exports = definePage({
  load: async () => ({ page: 'Login Page' }),
  render: (data) => `<main><h1>${data.page}</h1></main>`,
});

const { definePage } = require('../../../../../src/pages/define-page');

module.exports = definePage({
  load: async () => ({ message: 'Welcome to Webspresso' }),
  render: (data) => `<main><h1>${data.message}</h1></main>`,
});

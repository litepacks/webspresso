const { definePage } = require('../../../../../src/pages/define-page');

module.exports = definePage({
  load: async () => ({ title: 'About Us' }),
  render: (data) => `<main><h1>${data.title}</h1></main>`,
});

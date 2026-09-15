const { definePage } = require('../../../../../index');

module.exports = definePage({
  load: async () => ({ title: 'About Us' }),
  render: (data) => `<main><h1>${data.title}</h1></main>`,
});

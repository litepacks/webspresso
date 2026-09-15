const { definePage } = require('../../src/pages/define-page');

module.exports = definePage({
  load: async (ctx) => {
    return { name: ctx.query.name || 'Stranger' };
  },
  head: (data) => ({ title: `Hello ${data.name}` }),
  render: (data) => `<main><h1>Hello ${data.name}</h1></main>`,
});

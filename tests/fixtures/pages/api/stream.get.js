const { defineApi } = require('../../../../index');

module.exports = defineApi({
  handler: async (req, res, { sse }) => {
    const stream = sse({ heartbeat: false });
    await stream.send({ message: 'chunk 1' });
    await stream.send({ message: 'chunk 2' });
    stream.close();
  },
});

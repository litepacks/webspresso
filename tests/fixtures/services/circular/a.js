module.exports = {
  async handler(input, ctx) {
    return ctx.service('circular.b', input);
  },
};

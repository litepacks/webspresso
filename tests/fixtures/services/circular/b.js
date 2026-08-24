module.exports = {
  async handler(input, ctx) {
    return ctx.service('circular.a', input);
  },
};

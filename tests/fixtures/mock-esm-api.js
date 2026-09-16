module.exports = {
  default: {
    middleware: [(req, res, next) => next()],
    handler: async () => ({ esm: true }),
  },
};

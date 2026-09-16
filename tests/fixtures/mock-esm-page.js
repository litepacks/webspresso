module.exports = {
  default: {
    middleware: [(req, res, next) => next()],
    load: async () => 'Primitive string response',
  },
};

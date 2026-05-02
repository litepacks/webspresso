module.exports = {
  async load() {
    throw new Error('ssr-load-boom');
  },
};

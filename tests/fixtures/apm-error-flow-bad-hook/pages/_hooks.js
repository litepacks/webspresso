module.exports = {
  async onError() {
    throw new Error('on-error-hook-boom');
  },
};

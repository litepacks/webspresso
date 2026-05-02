/**
 * Test fixture: capture onError for integration tests.
 */
let lastOnError = null;

module.exports = {
  async onError(ctx, err) {
    lastOnError = {
      path: ctx.req && ctx.req.path,
      message: err && err.message,
    };
  },
  resetOnErrorCapture() {
    lastOnError = null;
  },
  getLastOnError() {
    return lastOnError;
  },
};

/**
 * Global Hooks
 * These hooks run for all routes
 */

module.exports = {
  /**
   * Called at the start of every request
   */
  async onRequest(ctx) {
    // Add request timestamp to context
    ctx.requestTime = Date.now();
  },

  /**
   * Called after the response is rendered
   */
  async afterRender(ctx) {
    // Log render time in development
    if (process.env.NODE_ENV !== 'production') {
      const duration = Date.now() - ctx.requestTime;
      console.log(`  Rendered in ${duration}ms`);
    }
  },

  /**
   * Called when an error occurs
   */
  async onError(ctx, err) {
    console.error(`[Error] ${ctx.req.path}:`, err.message);
  }
};



'use strict';

/**
 * Background job: (re)index a freshly created post — e.g. push to a search engine.
 * Dispatched by `services/post/create.js` via `ctx.queue.dispatch('post.index', { id })`.
 */
module.exports = async function indexPost(job, ctx) {
  const post = await ctx.db?.getRepository('Post').findById(job.data.id);
  return { indexed: Boolean(post), id: job.data.id };
};

module.exports.options = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
};


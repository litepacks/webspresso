'use strict';

/**
 * Decoupled listener for the `post.created` domain event.
 * Keeps an in-process counter; real apps would send notifications, bust CDN caches, etc.
 */
const stats = { created: 0, lastSlug: null };

module.exports = {
  event: 'post.created',
  handle(payload) {
    stats.created += 1;
    stats.lastSlug = payload?.slug ?? null;
  },
  stats,
};


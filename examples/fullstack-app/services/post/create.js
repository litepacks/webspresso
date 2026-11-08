'use strict';

const { defineService, ValidationError } = require('../../lib/webspresso');
const { slugify } = require('../../db/seed');

/**
 * Create a post inside an ACID transaction, then emit a domain event and enqueue a background job.
 */
module.exports = defineService({
  schema: ({ z }) => ({
    title: z.string().min(3).max(200),
    body: z.string().min(1),
    categoryId: z.coerce.number().int().positive(),
    authorId: z.coerce.number().int().positive(),
    publish: z.boolean().default(true),
  }),
  transaction: true,
  timeout: 5000,
  async handler(input, ctx) {
    const category = await ctx.db.getRepository('Category').findById(input.categoryId);
    if (!category) {
      throw new ValidationError('Unknown category', { fields: { categoryId: 'Category does not exist' } });
    }

    const PostRepo = ctx.db.getRepository('Post');
    const base = slugify(input.title) || 'post';
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const post = await PostRepo.create({
      title: input.title,
      slug: `${base}-${suffix}`,
      excerpt: input.body.slice(0, 160),
      body: input.body,
      status: input.publish ? 'published' : 'draft',
      views: 0,
      author_id: input.authorId,
      category_id: category.id,
      published_at: input.publish ? new Date() : null,
    });

    // Decoupled side effects: listeners/ and jobs/ react without coupling to this service.
    if (ctx.events) ctx.events.emit('post.created', { id: post.id, slug: post.slug });
    if (ctx.queue) await ctx.queue.dispatch('post.index', { id: post.id });

    // Invalidate memoized aggregates that depend on post counts.
    if (ctx.services) ctx.services.clearCache('stats.overview');

    return post;
  },
});

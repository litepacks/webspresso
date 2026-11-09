'use strict';

const { defineService } = require('../../lib/webspresso');

/** Category list (memoized for 30s via the services layer cache). */
module.exports = defineService({
  cache: { ttl: 30_000, key: () => 'category:list' },
  async handler(_input, ctx) {
    const categories = await ctx.db.getRepository('Category').query().orderBy('name', 'asc').find();
    return categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug }));
  },
});


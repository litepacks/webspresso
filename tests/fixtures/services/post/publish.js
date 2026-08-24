module.exports = {
  schema: {
    title: 'string',
    authorId: 'number',
  },
  async handler({ title, authorId }, ctx) {
    const author = await ctx.service('user.get', { id: authorId });
    return {
      id: 101,
      title,
      author,
      publishedAt: '2026-08-24T12:00:00.000Z',
    };
  },
};

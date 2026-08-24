module.exports = {
  schema: {
    userId: 'number',
  },
  async handler({ userId }, ctx) {
    const user = await ctx.service('user.get', { id: userId });
    return {
      user,
      bio: `Bio for ${user.name}`,
      theme: 'dark',
    };
  },
};

module.exports = {
  schema: {
    id: 'number',
  },
  async handler({ id }, ctx) {
    if (ctx.db && ctx.db.users) {
      return ctx.db.users.findById(id);
    }
    return { id, name: `User ${id}`, email: `user${id}@example.com` };
  },
};

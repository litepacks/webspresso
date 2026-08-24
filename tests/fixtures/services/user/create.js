module.exports = {
  schema: {
    name: 'string',
    email: 'email',
    role: 'string?',
  },
  async handler({ name, email, role = 'user' }, ctx) {
    return { id: 999, name, email, role, createdBy: ctx.user ? ctx.user.id : null };
  },
};

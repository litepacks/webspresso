'use strict';

const { defineApi } = require('../../../../../index');
const { NotFoundError } = require('../../../../../core/errors');
const { getTodoById } = require('../../../store');

module.exports = defineApi({
  schema: ({ z }) => ({
    params: z.object({
      id: z.coerce.number().int().min(1),
    }),
    response: z.object({
      id: z.number(),
      title: z.string(),
      completed: z.boolean(),
      priority: z.enum(['high', 'medium', 'low']),
      category: z.string(),
      notes: z.string(),
    }),
  }),
  async handler(req) {
    const todo = getTodoById(req.input.params.id);
    if (!todo) {
      throw new NotFoundError('Todo item not found');
    }
    return todo;
  },
});


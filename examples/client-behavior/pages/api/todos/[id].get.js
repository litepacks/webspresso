'use strict';

const { defineApi } = require('../../../../../index');
const { NotFoundError } = require('../../../../../core/errors');
const { getTodoById } = require('../../../store');

module.exports = defineApi({
  schema: ({ z }) => ({
    params: z.object({
      id: z.coerce.number().int().min(1),
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


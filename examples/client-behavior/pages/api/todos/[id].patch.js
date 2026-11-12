'use strict';

const { defineApi, apiResult } = require('../../../../../index');
const { NotFoundError } = require('../../../../../core/errors');
const { updateTodo } = require('../../../store');

module.exports = defineApi({
  schema: ({ z }) => ({
    params: z.object({
      id: z.coerce.number().int().min(1),
    }),
    body: z.object({
      title: z.string().trim().min(3, 'Task title must be at least 3 characters.').max(120).optional(),
      priority: z.enum(['high', 'medium', 'low']).optional(),
      category: z.string().trim().min(1).max(40).optional(),
      notes: z.string().trim().max(500).optional(),
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
    const updated = updateTodo(req.input.params.id, req.input.body);
    if (!updated) {
      throw new NotFoundError('Todo item not found');
    }
    return apiResult(updated, {
      invalidate: ['todos'],
    });
  },
});

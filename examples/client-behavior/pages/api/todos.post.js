'use strict';

const { defineApi, apiResult } = require('../../../../index');
const { createTodo } = require('../../store');

module.exports = defineApi({
  schema: ({ z }) => ({
    body: z.object({
      title: z
        .string()
        .trim()
        .min(3, 'Task title must be at least 3 characters (server Zod validation).')
        .max(120),
      priority: z.enum(['high', 'medium', 'low']).optional().default('medium'),
      category: z.string().trim().min(1).max(40).optional().default('architecture'),
      notes: z.string().trim().max(500).optional().default(''),
    }),
  }),
  async handler(req) {
    const created = createTodo(req.input.body);
    return apiResult(created, {
      status: 201,
      invalidate: ['todos'],
    });
  },
});

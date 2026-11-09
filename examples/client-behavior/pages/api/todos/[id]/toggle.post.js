'use strict';

const { defineApi, apiResult } = require('../../../../../../index');
const { NotFoundError } = require('../../../../../../core/errors');
const { toggleTodo } = require('../../../../store');

module.exports = defineApi({
  schema: ({ z }) => ({
    params: z.object({
      id: z.coerce.number().int().min(1),
    }),
  }),
  async handler(req) {
    const updated = toggleTodo(req.input.params.id);
    if (!updated) {
      throw new NotFoundError('Todo item not found');
    }
    return apiResult(updated, {
      invalidate: ['todos'],
    });
  },
});

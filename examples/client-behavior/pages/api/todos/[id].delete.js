'use strict';

const { defineApi, apiResult } = require('../../../../../index');
const { deleteTodo } = require('../../../store');

module.exports = defineApi({
  schema: ({ z }) => ({
    params: z.object({
      id: z.coerce.number().int().min(1),
    }),
  }),
  async handler(req) {
    const id = req.input.params.id;
    deleteTodo(id);
    return apiResult(
      { deleted: true, id },
      {
        invalidate: ['todos'],
      }
    );
  },
});

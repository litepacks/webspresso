const { defineService } = require('../../../../../../../src/services');
const { z } = require('zod');

module.exports = defineService({
  schema: z.object({
    email: z.string().email(),
    password: z.string().min(4),
  }),
  handler: async (input) => {
    return {
      success: true,
      token: 'jwt_mock_token_123',
      email: input.email,
    };
  },
});

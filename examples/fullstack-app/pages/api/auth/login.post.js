'use strict';

const { loginLimiter } = require('../../../lib/limiters');

/**
 * POST /api/auth/login — credential check + stateless JWT access/refresh tokens.
 */
module.exports = {
  middleware: [loginLimiter],
  schema: ({ z }) => ({
    body: z.object({
      email: z.string().email(),
      password: z.string().min(1),
    }),
  }),
  async handler(req, res) {
    const { email, password } = req.input.body;
    const user = await req.auth.attempt(email, password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    return res.json({
      accessToken: req.auth.generateUserToken(user),
      refreshToken: req.auth.generateRefreshToken(user),
      user,
    });
  },
};


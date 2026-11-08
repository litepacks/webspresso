'use strict';

/** GET /api/me — requires `Authorization: Bearer <accessToken>`. */
module.exports = {
  middleware: ['jwt'],
  async handler(req, res) {
    return res.json({ user: req.user });
  },
};


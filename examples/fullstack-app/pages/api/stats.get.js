'use strict';

/** GET /api/stats — memoized dashboard aggregates. */
module.exports = {
  async handler(req, res) {
    return res.json({ data: await req.service('stats.overview', {}) });
  },
};


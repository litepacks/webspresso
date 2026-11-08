'use strict';

/** GET /api/categories — memoized service result. */
module.exports = {
  async handler(req, res) {
    return res.json({ data: await req.service('category.list', {}) });
  },
};


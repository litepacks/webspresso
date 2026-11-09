'use strict';

const { defineApi } = require('../../../../../index');
const { getTodoInsights } = require('../../../store');

module.exports = defineApi({
  async handler(_req, res) {
    return res.json(getTodoInsights());
  },
});

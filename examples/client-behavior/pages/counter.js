'use strict';

const { defineFragment } = require('../../../core/client');
const { getCounter } = require('../store');

module.exports = {
  async load() {
    return {
      pageTitle: 'Server Fragment Counter',
      count: getCounter(),
    };
  },

  fragments: {
    count: defineFragment({
      template: 'partials/counter-display.njk',
      dependsOn: ['counter'],
      async load() {
        return {
          count: getCounter(),
        };
      },
    }),
  },
};

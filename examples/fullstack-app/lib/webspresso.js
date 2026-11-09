'use strict';

/**
 * In-repo shim so the example always runs against the local framework source.
 *
 * In a real project, replace `require('../lib/webspresso')` with `require('webspresso')`,
 * `.plugins` with `require('webspresso/plugins')` and `.auth` with `require('webspresso/core/auth')`.
 */
const webspresso = require('../../../');

// The framework entry exposes lazy getters, so extend it through the prototype chain.
const shim = Object.create(webspresso);
Object.defineProperties(shim, {
  plugins: { value: require('../../../plugins'), enumerable: true },
  auth: { value: require('../../../core/auth'), enumerable: true },
});

module.exports = shim;

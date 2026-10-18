'use strict';

const { hmacSha256 } = require('./crypto');

module.exports = hmacSha256;
module.exports.hmacSha256 = hmacSha256;

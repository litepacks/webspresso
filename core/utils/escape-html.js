'use strict';

const { escapeHtml, unescapeHtml } = require('./html');

module.exports = escapeHtml;
module.exports.escapeHtml = escapeHtml;
module.exports.unescapeHtml = unescapeHtml;

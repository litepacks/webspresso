/**
 * Admin SPA source is split under {@link ./client/parts}; order is declared in {@link ./client/manifest.parts.json}.
 * Built at runtime by {@link ./client/load-parts} (no bundler required for npm consumers).
 */

'use strict';

module.exports = require('./client/load-parts').buildComponentsBody();

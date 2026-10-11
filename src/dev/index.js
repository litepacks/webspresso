'use strict';

/**
 * Webspresso Development & DX Tooling
 * Zero-dependency banner, route table introspection, request profiler, and N+1 query detection
 * @module src/dev
 */

const { colors, createColors, stripAnsi, isColorSupported } = require('./colors');
const {
  formatRouteTable,
  collectBannerSummary,
  formatDevBanner,
  printDevBanner,
} = require('./banner');
const {
  profilerStorage,
  attachProfilerToKnex,
  extractTableFromSql,
  detectNPlusOne,
  formatRequestLog,
  createDevProfilerMiddleware,
} = require('./profiler');

const {
  zodToTsType,
  collectModelMetadata,
  collectServiceMetadata,
  collectRouteMetadata,
  generateDeclarationCode,
  generateTypes,
} = require('./typegen');

module.exports = {
  // Colors & ANSI
  colors,
  createColors,
  stripAnsi,
  isColorSupported,

  // Banner & Route Table
  formatRouteTable,
  collectBannerSummary,
  formatDevBanner,
  printDevBanner,

  // Profiler & N+1 Detection
  profilerStorage,
  attachProfilerToKnex,
  extractTableFromSql,
  detectNPlusOne,
  formatRequestLog,
  createDevProfilerMiddleware,

  // TypeGen
  zodToTsType,
  collectModelMetadata,
  collectServiceMetadata,
  collectRouteMetadata,
  generateDeclarationCode,
  generateTypes,
};

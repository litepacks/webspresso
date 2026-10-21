/**
 * Webspresso Feature Flags & Canary Traffic Splitter
 * Zero-dependency feature flag and traffic bucketing engine.
 * @module core/flags
 */

'use strict';

const { FeatureFlagManager, createFeatureFlagManager } = require('./manager');
const { MemoryFlagStore } = require('./store');
const { evaluateFlag } = require('./evaluator');
const { getBucket, fnv1a } = require('./hasher');

module.exports = {
  FeatureFlagManager,
  createFeatureFlagManager,
  MemoryFlagStore,
  evaluateFlag,
  getBucket,
  fnv1a,
};

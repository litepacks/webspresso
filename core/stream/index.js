'use strict';

/**
 * Webspresso Streaming Subsystem
 * Text, NDJSON, and real-time AI/LLM streaming utilities
 * @module core/stream
 */

const {
  TextStreamController,
  streamText,
  streamJson,
} = require('./text-stream');

module.exports = {
  TextStreamController,
  streamText,
  streamJson,
};

/**
 * Webhooks Event Pattern Matcher
 * Supports wildcard matching (*, user.*, order.item.*)
 * @module plugins/webhooks/matcher
 */

'use strict';

const { globToRegExp } = require('../../core/utils/regex');
const { safeJsonParse } = require('../../core/utils/json');

/**
 * Normalize an event filter into an array of strings
 * 
 * @param {string|string[]|any} events 
 * @returns {string[]}
 */
function normalizeEvents(events) {
  if (!events) {
    return ['*'];
  }

  if (Array.isArray(events)) {
    return events
      .map((e) => (typeof e === 'string' ? e.trim() : ''))
      .filter(Boolean);
  }

  if (typeof events === 'string') {
    const trimmed = events.trim();
    if (!trimmed) return ['*'];

    // If JSON array string like '["user.*", "order.created"]'
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const parsed = safeJsonParse(trimmed, null);
      if (Array.isArray(parsed)) {
        return parsed.map((e) => (typeof e === 'string' ? e.trim() : '')).filter(Boolean);
      }
    }

    return trimmed
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
  }

  return ['*'];
}

const regexCache = new Map();
const MAX_REGEX_CACHE = 1000;

function getPatternRegex(pattern) {
  let cached = regexCache.get(pattern);
  if (!cached) {
    if (regexCache.size >= MAX_REGEX_CACHE) {
      const first = regexCache.keys().next().value;
      if (first !== undefined) regexCache.delete(first);
    }
    cached = globToRegExp(pattern, { separator: null, flags: 'i' });
    regexCache.set(pattern, cached);
  }
  return cached;
}

/**
 * Test whether an event pattern matches an actual event name
 * 
 * @param {string} pattern - E.g. '*', 'user.*', 'order.created', 'billing.invoice.paid'
 * @param {string} eventName - E.g. 'user.created', 'order.created'
 * @returns {boolean}
 */
function matchEvent(pattern, eventName) {
  if (typeof pattern !== 'string' || typeof eventName !== 'string') {
    return false;
  }

  const p = pattern.trim();
  const e = eventName.trim();
  if (!p || !e) {
    return false;
  }

  // 1. Wildcard matches all
  if (p === '*') {
    return true;
  }

  // 2. Exact match
  if (p === e) {
    return true;
  }

  // 3. Glob / Wildcard conversion with bounded cache
  return getPatternRegex(p).test(e);
}

/**
 * Check if an event name matches any pattern in a list
 * 
 * @param {string|string[]} patterns 
 * @param {string} eventName 
 * @returns {boolean}
 */
function matchesAnyEvent(patterns, eventName) {
  const list = normalizeEvents(patterns);
  if (list.length === 0) {
    return false;
  }

  for (const pattern of list) {
    if (matchEvent(pattern, eventName)) {
      return true;
    }
  }

  return false;
}

module.exports = {
  normalizeEvents,
  matchEvent,
  matchesAnyEvent,
};

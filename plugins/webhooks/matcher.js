/**
 * Webhooks Event Pattern Matcher
 * Supports wildcard matching (*, user.*, order.item.*)
 * @module plugins/webhooks/matcher
 */

'use strict';

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
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((e) => (typeof e === 'string' ? e.trim() : '')).filter(Boolean);
        }
      } catch (err) {
        // Fall back to comma-separated
      }
    }

    return trimmed
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
  }

  return ['*'];
}

/**
 * Test whether an event pattern matches an actual event name
 * 
 * @param {string} pattern - E.g. '*', 'user.*', 'order.created', 'billing.invoice.paid'
 * @param {string} eventName - E.g. 'user.created', 'order.created'
 * @returns {boolean}
 */
function matchEvent(pattern, eventName) {
  if (!pattern || !eventName) {
    return false;
  }

  const p = pattern.trim();
  const e = eventName.trim();

  // 1. Wildcard matches all
  if (p === '*') {
    return true;
  }

  // 2. Exact match
  if (p === e) {
    return true;
  }

  // 3. Glob / Wildcard conversion
  // Convert 'user.*' to regular expression '^user\.[^.]+$' or '^user\..+$'
  // Support prefix, middle, or suffix wildcards safely
  const escaped = p
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // escape regex specials except *
    .replace(/\*/g, '.*');

  const regex = new RegExp(`^${escaped}$`, 'i');
  return regex.test(e);
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

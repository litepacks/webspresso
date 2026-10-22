/**
 * Unit tests for Webhooks Event Pattern Matcher
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeEvents,
  matchEvent,
  matchesAnyEvent,
} from '../../../plugins/webhooks/matcher';

describe('Webhooks Matcher & Wildcard Resolution', () => {
  describe('normalizeEvents', () => {
    it('returns ["*"] for null, undefined, or empty values', () => {
      expect(normalizeEvents(null)).toEqual(['*']);
      expect(normalizeEvents(undefined)).toEqual(['*']);
      expect(normalizeEvents('')).toEqual(['*']);
      expect(normalizeEvents('   ')).toEqual(['*']);
      expect(normalizeEvents([])).toEqual([]);
      expect(normalizeEvents(12345)).toEqual(['*']);
    });

    it('normalizes string arrays, trimming whitespace and filtering empty elements', () => {
      const input = [' user.created ', '', '  order.shipped', null];
      expect(normalizeEvents(input)).toEqual(['user.created', 'order.shipped']);
    });

    it('normalizes comma-separated strings', () => {
      expect(normalizeEvents('user.created, order.paid , item.added')).toEqual([
        'user.created',
        'order.paid',
        'item.added',
      ]);
    });

    it('parses JSON stringified arrays and falls back gracefully', () => {
      const jsonInput = '["order.*", "user.signup"]';
      expect(normalizeEvents(jsonInput)).toEqual(['order.*', 'user.signup']);

      const brokenJson = '["order.*", broken';
      expect(normalizeEvents(brokenJson)).toEqual(['["order.*"', 'broken']);
    });
  });

  describe('matchEvent', () => {
    it('returns false for empty pattern or eventName', () => {
      expect(matchEvent('', 'user.created')).toBe(false);
      expect(matchEvent('user.created', '')).toBe(false);
      expect(matchEvent(null, 'user.created')).toBe(false);
      expect(matchEvent('user.created', null)).toBe(false);
    });

    it('matches all events when pattern is wildcard "*"', () => {
      expect(matchEvent('*', 'user.created')).toBe(true);
      expect(matchEvent('*', 'order.refund.approved')).toBe(true);
      expect(matchEvent(' * ', 'system.alert')).toBe(true);
    });

    it('matches exact event names case-insensitively', () => {
      expect(matchEvent('user.created', 'user.created')).toBe(true);
      expect(matchEvent('USER.CREATED', 'user.created')).toBe(true);
      expect(matchEvent('user.created', 'user.updated')).toBe(false);
    });

    it('matches prefix, suffix, and infix wildcard patterns', () => {
      // Prefix wildcard
      expect(matchEvent('*.created', 'user.created')).toBe(true);
      expect(matchEvent('*.created', 'order.item.created')).toBe(true);
      expect(matchEvent('*.created', 'user.deleted')).toBe(false);

      // Suffix wildcard
      expect(matchEvent('user.*', 'user.created')).toBe(true);
      expect(matchEvent('user.*', 'user.profile.updated')).toBe(true);
      expect(matchEvent('user.*', 'organization.created')).toBe(false);

      // Infix wildcard
      expect(matchEvent('order.*.shipped', 'order.express.shipped')).toBe(true);
      expect(matchEvent('order.*.shipped', 'order.shipped')).toBe(false);
    });

    it('safely escapes special regex characters in event patterns', () => {
      expect(matchEvent('user+account.*', 'user+account.created')).toBe(true);
      expect(matchEvent('user(vip).*', 'user(vip).login')).toBe(true);
    });
  });

  describe('matchesAnyEvent', () => {
    it('returns true if any pattern matches the event name', () => {
      expect(matchesAnyEvent(['user.*', 'order.*'], 'order.placed')).toBe(true);
      expect(matchesAnyEvent('user.login, order.placed', 'order.placed')).toBe(true);
      expect(matchesAnyEvent('*', 'anything.goes')).toBe(true);
    });

    it('returns false if no pattern matches or list is empty', () => {
      expect(matchesAnyEvent(['user.*', 'customer.*'], 'order.placed')).toBe(false);
      expect(matchesAnyEvent([], 'order.placed')).toBe(false);
    });
  });
});

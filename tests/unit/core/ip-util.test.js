'use strict';

import { describe, it, expect } from 'vitest';
const { getClientIp } = require('../../../core/utils/ip');
const { getClientIp: getClientIpFromUtilsIndex } = require('../../../core/utils');
const { getClientIp: getClientIpFromIndex } = require('../../../index');
const { getClientIp: getClientIpFromAuth } = require('../../../core/auth');
const { getClientIp: getClientIpFromUserAgent } = require('../../../core/auth/user-agent');
const { utils } = require('../../../src/helpers');

describe('Universal getClientIp Utility', () => {
  describe('exports consistency', () => {
    it('exports identical functions across all public touchpoints', () => {
      expect(getClientIp).toBeTypeOf('function');
      expect(getClientIpFromUtilsIndex).toBe(getClientIp);
      expect(getClientIpFromIndex).toBe(getClientIp);
      expect(getClientIpFromAuth).toBe(getClientIp);
      expect(getClientIpFromUserAgent).toBe(getClientIp);
      expect(utils.getClientIp).toBeTypeOf('function');
    });
  });

  describe('nullish and non-object inputs', () => {
    it('returns default 127.0.0.1 fallback when req is null or undefined', () => {
      expect(getClientIp(null)).toBe('127.0.0.1');
      expect(getClientIp(undefined)).toBe('127.0.0.1');
      expect(getClientIp()).toBe('127.0.0.1');
    });

    it('returns default 127.0.0.1 fallback when req is not an object', () => {
      expect(getClientIp('not an object')).toBe('127.0.0.1');
      expect(getClientIp(12345)).toBe('127.0.0.1');
      expect(getClientIp(true)).toBe('127.0.0.1');
    });

    it('returns default 127.0.0.1 for an empty request object', () => {
      expect(getClientIp({})).toBe('127.0.0.1');
      expect(getClientIp({ headers: {} })).toBe('127.0.0.1');
    });

    it('supports custom fallback for nullish or empty requests', () => {
      expect(getClientIp(null, '')).toBe('');
      expect(getClientIp(null, null)).toBeNull();
      expect(getClientIp(null, undefined)).toBeUndefined();
      expect(getClientIp({}, '0.0.0.0')).toBe('0.0.0.0');
      expect(utils.getClientIp(null, 'custom-fallback')).toBe('custom-fallback');
    });
  });

  describe('x-forwarded-for extraction', () => {
    it('extracts single IP from x-forwarded-for header', () => {
      const req = { headers: { 'x-forwarded-for': '203.0.113.195' } };
      expect(getClientIp(req)).toBe('203.0.113.195');
    });

    it('extracts first IP from comma-separated x-forwarded-for header with whitespace trimming', () => {
      const req = {
        headers: {
          'x-forwarded-for': '  203.0.113.195  , 70.41.3.18, 150.172.238.178',
        },
      };
      expect(getClientIp(req)).toBe('203.0.113.195');
    });

    it('extracts first IP from array-format x-forwarded-for header', () => {
      const req = {
        headers: {
          'x-forwarded-for': ['  198.51.100.1  ', '192.168.1.1'],
        },
      };
      expect(getClientIp(req)).toBe('198.51.100.1');
    });

    it('supports uppercase X-Forwarded-For header', () => {
      const req = {
        headers: {
          'X-Forwarded-For': '198.51.100.55',
        },
      };
      expect(getClientIp(req)).toBe('198.51.100.55');
    });

    it('resolves via req.get() if header property is missing directly', () => {
      const req = {
        get(name) {
          if (name.toLowerCase() === 'x-forwarded-for') {
            return '198.51.100.99, 10.0.0.1';
          }
          return null;
        },
      };
      expect(getClientIp(req)).toBe('198.51.100.99');
    });
  });

  describe('fallback chain precedence', () => {
    it('prioritizes x-forwarded-for over x-real-ip, req.ip, and socket address', () => {
      const req = {
        headers: {
          'x-forwarded-for': '203.0.113.1',
          'x-real-ip': '203.0.113.2',
        },
        ip: '203.0.113.3',
        connection: { remoteAddress: '203.0.113.4' },
        socket: { remoteAddress: '203.0.113.5' },
      };
      expect(getClientIp(req)).toBe('203.0.113.1');
    });

    it('falls back to x-real-ip when x-forwarded-for is missing', () => {
      const req = {
        headers: {
          'x-real-ip': '192.168.1.10',
        },
        ip: '10.0.0.1',
      };
      expect(getClientIp(req)).toBe('192.168.1.10');
    });

    it('supports uppercase X-Real-IP header', () => {
      const req = {
        headers: {
          'X-Real-IP': '192.168.1.25',
        },
      };
      expect(getClientIp(req)).toBe('192.168.1.25');
    });

    it('falls back to req.ip when proxy headers are absent', () => {
      const req = {
        headers: {},
        ip: '10.0.0.1',
        socket: { remoteAddress: '172.16.0.1' },
      };
      expect(getClientIp(req)).toBe('10.0.0.1');
    });

    it('falls back to req.connection.remoteAddress', () => {
      const req = {
        headers: {},
        connection: { remoteAddress: '172.16.0.5' },
        socket: { remoteAddress: '172.16.0.6' },
      };
      expect(getClientIp(req)).toBe('172.16.0.5');
    });

    it('falls back to req.socket.remoteAddress', () => {
      const req = {
        headers: {},
        socket: { remoteAddress: '172.16.0.6' },
      };
      expect(getClientIp(req)).toBe('172.16.0.6');
    });

    it('falls back to req.info.remoteAddress if present', () => {
      const req = {
        headers: {},
        info: { remoteAddress: '172.16.0.9' },
      };
      expect(getClientIp(req)).toBe('172.16.0.9');
    });

    it('ignores empty string or whitespace-only headers and continues to next fallback', () => {
      const req = {
        headers: {
          'x-forwarded-for': '   ',
          'x-real-ip': '   ',
        },
        ip: '10.0.0.42',
      };
      expect(getClientIp(req)).toBe('10.0.0.42');
    });
  });
});

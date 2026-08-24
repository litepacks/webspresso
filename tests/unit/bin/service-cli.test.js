/**
 * @vitest-environment node
 */

import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { parseInputPayload, registerCommand } = require('../../../bin/commands/service');
const { program } = require('commander');

describe('service CLI command', () => {
  describe('parseInputPayload helper', () => {
    it('should parse valid JSON string', () => {
      expect(parseInputPayload('{"id": 42, "name": "Alice"}')).toEqual({
        id: 42,
        name: 'Alice',
      });
    });

    it('should parse key=value query string format', () => {
      expect(parseInputPayload('id=42&name=Bob&active=true')).toEqual({
        id: 42,
        name: 'Bob',
        active: true,
      });
    });

    it('should parse space-separated key=value pairs', () => {
      expect(parseInputPayload('transactionId=tx_123 amount=99.5')).toEqual({
        transactionId: 'tx_123',
        amount: 99.5,
      });
    });

    it('should return empty object for empty or nullish strings', () => {
      expect(parseInputPayload('')).toEqual({});
      expect(parseInputPayload(null)).toEqual({});
      expect(parseInputPayload(undefined)).toEqual({});
    });

    it('should throw clear error on malformed JSON', () => {
      expect(() => parseInputPayload('{ invalid json }')).toThrow(/Invalid JSON input/);
    });
  });

  describe('Command Registration in Commander', () => {
    it('should register service, service:run, and service:call commands', () => {
      const testProgram = program.createCommand();
      registerCommand(testProgram);

      const cmd = testProgram.commands.find((c) => c.name() === 'service');
      expect(cmd).toBeDefined();
      expect(cmd.aliases()).toContain('service:run');
      expect(cmd.aliases()).toContain('service:call');
    });
  });
});

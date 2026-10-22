import { createTempDir, cleanupDir } from '../utils';
/**
 * Unit & Integration Tests: Management Commands & CLI DX (Item #7)
 * - defineCommand, createCommandRegistry, executeCommand
 * - Command auto-discovery and nested subcommands
 * - Scaffolding generators: make:command, make:policy, make:factory, make:event, make:mail
 * - Argument and flag parsing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  defineCommand,
  createCommandRegistry,
  executeCommand,
  findCommandFiles,
  deriveCommandName,
} from '../../core/commands/index.js';
import { parseRawArgs } from '../../bin/commands/run.js';
import { generateCommandContent } from '../../bin/commands/make-command.js';
import { generatePolicyContent } from '../../bin/commands/make-policy.js';
import { generateFactoryContent } from '../../bin/commands/make-factory.js';
import { generateEventContent } from '../../bin/commands/make-event.js';
import { generateMailContent } from '../../bin/commands/make-mail.js';

describe('Management Commands & CLI DX (Item #7)', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir('webspresso-cmd-test');
  });

  afterEach(() => {
    try {
      cleanupDir(tempDir);
    } catch (_) {}
  });

  describe('defineCommand', () => {
    it('validates required fields and normalizes command configuration', () => {
      const cmd = defineCommand({
        name: 'users:cleanup',
        description: 'Remove inactive users older than 30 days',
        options: [
          { flags: '-d, --dry-run', description: 'Simulate cleanup' },
          { flags: '-l, --limit <count>', defaultValue: 100 },
        ],
        handle: async ({ flags }) => {
          return { cleaned: flags.dryRun ? 0 : 42 };
        },
      });

      expect(cmd.name).toBe('users:cleanup');
      expect(cmd.description).toBe('Remove inactive users older than 30 days');
      expect(cmd.options).toHaveLength(2);
      expect(cmd.options[0].flags).toBe('-d, --dry-run');
      expect(cmd.options[1].defaultValue).toBe(100);
      expect(typeof cmd.handle).toBe('function');
    });

    it('throws TypeError when name or handle is invalid', () => {
      expect(() => defineCommand(null)).toThrow(TypeError);
      expect(() => defineCommand({})).toThrow(/must specify a non-empty string "name"/);
      expect(() => defineCommand({ name: 'test' })).toThrow(/must provide an executable "handle" function/);
    });

    it('accepts run alias instead of handle', () => {
      const cmd = defineCommand({
        name: 'test:run',
        run: async () => 'ok',
      });
      expect(cmd.handle).toBeDefined();
    });
  });

  describe('createCommandRegistry & Auto-Discovery', () => {
    it('registers and retrieves custom command definitions', () => {
      const registry = createCommandRegistry({ commandsDir: tempDir, autoLoad: false });

      registry.register({
        name: 'billing:invoice',
        description: 'Generate monthly invoices',
        handle: async () => 'invoiced',
      });

      expect(registry.has('billing:invoice')).toBe(true);
      expect(registry.has('non-existent')).toBe(false);
      expect(registry.get('billing:invoice').description).toBe('Generate monthly invoices');
      expect(registry.names()).toEqual(['billing:invoice']);
      expect(registry.list()).toHaveLength(1);
    });

    it('auto-discovers commands from flat and nested directories', () => {
      // Create test directory structure:
      // tempDir/
      //   cleanup.js
      //   _private.js (should be ignored)
      //   test.spec.js (should be ignored)
      //   billing/
      //     invoices.js
      //     subscriptions/
      //       renew.js

      fs.writeFileSync(
        path.join(tempDir, 'cleanup.js'),
        `module.exports = {
          description: 'Top-level cleanup',
          handle: async () => 'cleaned',
        };`
      );

      fs.writeFileSync(path.join(tempDir, '_private.js'), 'module.exports = {};');
      fs.writeFileSync(path.join(tempDir, 'sample.test.js'), 'module.exports = {};');

      const billingDir = path.join(tempDir, 'billing');
      fs.mkdirSync(billingDir);
      fs.writeFileSync(
        path.join(billingDir, 'invoices.js'),
        `module.exports = {
          name: 'billing:invoices',
          description: 'Process invoices',
          handle: async () => 'processed',
        };`
      );

      const subDir = path.join(billingDir, 'subscriptions');
      fs.mkdirSync(subDir);
      fs.writeFileSync(
        path.join(subDir, 'renew.js'),
        `module.exports = {
          handle: async () => 'renewed',
        };`
      );

      const registry = createCommandRegistry({ commandsDir: tempDir });
      const names = registry.names();

      expect(names).toContain('cleanup');
      expect(names).toContain('billing:invoices');
      expect(names).toContain('billing:subscriptions:renew');
      expect(names).not.toContain('_private');
      expect(names).not.toContain('sample.test');

      const renewCmd = registry.get('billing:subscriptions:renew');
      expect(renewCmd).toBeDefined();
      expect(typeof renewCmd.handle).toBe('function');
    });

    it('derives command names from relative paths correctly', () => {
      expect(deriveCommandName('cleanup.js')).toBe('cleanup');
      expect(deriveCommandName('users/prune.js')).toBe('users:prune');
      expect(deriveCommandName('billing/v2/charge.js')).toBe('billing:v2:charge');
    });
  });

  describe('executeCommand & Execution Lifecycle', () => {
    it('executes command and injects complete framework context', async () => {
      const mockDb = { getRepository: vi.fn().mockReturnValue('mockRepo') };
      const mockQueue = { dispatch: vi.fn() };
      const mockMailer = { send: vi.fn() };
      const mockEvents = { emit: vi.fn() };
      const logs = [];
      const mockLogger = { log: (msg) => logs.push(msg) };

      const cmd = defineCommand({
        name: 'sync:data',
        handle: async ({ db, queue, mailer, events, logger, args, flags }) => {
          logger.log('Starting sync');
          events.emit('sync:started', { target: args[0] });
          return {
            repo: db.getRepository('User'),
            flagValue: flags.force,
            target: args[0],
          };
        },
      });

      const outcome = await executeCommand(cmd, {
        args: ['production'],
        flags: { force: true },
        db: mockDb,
        queue: mockQueue,
        mailer: mockMailer,
        events: mockEvents,
        logger: mockLogger,
      });

      expect(outcome.success).toBe(true);
      expect(outcome.result.repo).toBe('mockRepo');
      expect(outcome.result.flagValue).toBe(true);
      expect(outcome.result.target).toBe('production');
      expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
      expect(logs).toContain('Starting sync');
      expect(mockEvents.emit).toHaveBeenCalledWith('sync:started', { target: 'production' });
    });

    it('catches execution errors and returns failure object without throwing unhandled exceptions', async () => {
      const failingCmd = defineCommand({
        name: 'fail:test',
        handle: async () => {
          throw new Error('Database connection failed during command');
        },
      });

      const outcome = await executeCommand(failingCmd);

      expect(outcome.success).toBe(false);
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.error.message).toContain('Database connection failed');
      expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('CLI Flag & Argument Parsing (parseRawArgs)', () => {
    it('parses long flags, short flags, boolean flags, numbers, and positional args', () => {
      const raw = [
        '--dry-run',
        '--limit',
        '50',
        '--filter=active',
        '-v',
        '-e',
        'staging',
        'user@example.com',
        'backup.sql',
      ];

      const { flags, args } = parseRawArgs(raw);

      expect(flags.dryRun).toBe(true);
      expect(flags.limit).toBe(50);
      expect(flags.filter).toBe('active');
      expect(flags.v).toBe(true);
      expect(flags.e).toBe('staging');
      expect(args).toEqual(['user@example.com', 'backup.sql']);
    });
  });

  describe('Scaffolding Generators (Adonis Ace & Django-inspired)', () => {
    it('generateCommandContent creates valid code with defineCommand', () => {
      const code = generateCommandContent('sync-stripe', 'Sync Stripe customer subscriptions');
      expect(code).toContain("const { defineCommand } = require('webspresso');");
      expect(code).toContain("name: 'sync-stripe'");
      expect(code).toContain('Sync Stripe customer subscriptions');
      expect(code).toContain('handle: async ({ db, queue, services, mailer, events, logger, args, flags })');
    });

    it('generatePolicyContent creates valid Bouncer policy code', () => {
      const code = generatePolicyContent('Article');
      expect(code).toContain("name: 'article'");
      expect(code).toContain('async view(user, record)');
      expect(code).toContain('async update(user, record)');
      expect(code).toContain('async delete(user, record)');
    });

    it('generateFactoryContent creates valid model factory code', () => {
      const code = generateFactoryContent('Product');
      expect(code).toContain("const { defineFactory } = require('webspresso');");
      expect(code).toContain("defineFactory('Product', ({ faker, seq }) =>");
    });

    it('generateEventContent creates valid event listener code', () => {
      const code = generateEventContent('order:completed');
      expect(code).toContain("event: 'order:completed'");
      expect(code).toContain('async handle(payload, ctx = {})');
    });

    it('generateMailContent creates valid Mailable subclass code', () => {
      const code = generateMailContent('Invoice');
      expect(code).toContain("const { Mailable } = require('webspresso');");
      expect(code).toContain('class InvoiceEmail extends Mailable');
      expect(code).toContain('build()');
    });
  });

  describe('End-to-End Command File Execution', () => {
    it('creates command file, loads it via registry, and executes it with context', async () => {
      const commandsDir = path.join(tempDir, 'commands');
      fs.mkdirSync(commandsDir, { recursive: true });

      const cmdPath = path.join(commandsDir, 'prune-tokens.js');
      fs.writeFileSync(
        cmdPath,
        `const { defineCommand } = require('${path.resolve(__dirname, '../../index.js')}');
        module.exports = defineCommand({
          name: 'prune-tokens',
          description: 'Prune expired auth tokens',
          options: [{ flags: '--dry-run', defaultValue: false }],
          handle: async ({ flags, logger }) => {
            logger.log('Pruning tokens, dryRun=' + flags.dryRun);
            return { deletedCount: flags.dryRun ? 0 : 15 };
          },
        });`
      );

      const registry = createCommandRegistry({ commandsDir });
      expect(registry.has('prune-tokens')).toBe(true);

      const cmdDef = registry.get('prune-tokens');
      const messages = [];
      const outcome = await executeCommand(cmdDef, {
        flags: { dryRun: true },
        logger: { log: (m) => messages.push(m) },
      });

      expect(outcome.success).toBe(true);
      expect(outcome.result.deletedCount).toBe(0);
      expect(messages).toContain('Pruning tokens, dryRun=true');
    });
  });
});

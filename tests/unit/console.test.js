'use strict';

/**
 * Webspresso - Interactive Console & REPL Unit Tests
 * Tests buildConsoleContext, evaluateInConsole, startConsole, and custom dot commands.
 */

const { PassThrough } = require('stream');
const path = require('path');
const {
  buildConsoleContext,
  evaluateInConsole,
  startConsole,
  registerConsoleCommands,
  isValidIdentifier,
} = require('../../core/console');
const { createDatabase, defineModel, zdb } = require('../../core/orm');
const { createServiceRegistry, defineService } = require('../../src/services');
const { createFeatureFlagManager } = require('../../core/flags');

describe('Webspresso Interactive Console & REPL', () => {
  describe('1. Identifier Validation & Helpers', () => {
    it('validates JavaScript identifier names accurately', () => {
      expect(isValidIdentifier('Note')).toBe(true);
      expect(isValidIdentifier('User')).toBe(true);
      expect(isValidIdentifier('$secret')).toBe(true);
      expect(isValidIdentifier('_private')).toBe(true);
      expect(isValidIdentifier('UserRole123')).toBe(true);

      expect(isValidIdentifier('123Note')).toBe(false);
      expect(isValidIdentifier('note-item')).toBe(false);
      expect(isValidIdentifier('note item')).toBe(false);
      expect(isValidIdentifier('')).toBe(false);
    });
  });

  describe('2. buildConsoleContext()', () => {
    it('bootstraps empty context gracefully when no database is configured', async () => {
      const { context, meta, teardown } = await buildConsoleContext({
        rootDir: __dirname,
        env: 'test',
      });

      expect(context).toBeDefined();
      expect(meta).toBeDefined();
      expect(meta.env).toBe('test');
      expect(meta.rootDir).toBe(__dirname);
      expect(typeof context.help).toBe('function');
      expect(typeof context.reload).toBe('function');
      expect(typeof context.service).toBe('function');
      expect(context.context).toBe(context);

      expect(context.events).toBeDefined();
      expect(typeof context.events.emit).toBe('function');
      expect(typeof context.events.dispatch).toBe('function');

      expect(context.flags).toBeDefined();
      expect(typeof context.flags.isEnabled).toBe('function');

      expect(context.cache).toBeDefined();
      expect(typeof context.cache.get).toBe('function');

      await teardown();
    });

    it('injects pre-instantiated database, models, and creates direct shortcuts', async () => {
      const testDb = createDatabase({
        client: 'sqlite3',
        connection: ':memory:',
        useNullAsDefault: true,
      });

      const TestItem = defineModel({
        name: 'TestConsoleItem',
        table: 'test_console_items',
        schema: {
          id: zdb.id(),
          name: zdb.string(),
        },
      });

      testDb.registerModel(TestItem);

      const { context, meta, teardown } = await buildConsoleContext({
        db: testDb,
        env: 'test',
      });

      expect(meta.hasDb).toBe(true);
      expect(context.db).toBe(testDb);
      expect(context.models).toHaveProperty('TestConsoleItem');
      // Direct shortcut on context
      expect(context.TestConsoleItem).toBe(testDb.getRepository('TestConsoleItem'));

      await teardown();
      if (testDb.knex) await testDb.knex.destroy();
    });

    it('injects pre-instantiated services and invokes via service() shortcut', async () => {
      const registry = createServiceRegistry();
      registry.register(
        defineService({
          name: 'math.add',
          schema: ({ z }) => z.object({ a: z.number(), b: z.number() }),
          handler: async ({ input }) => input.a + input.b,
        })
      );

      const { context, meta, teardown } = await buildConsoleContext({
        services: registry,
        env: 'test',
      });

      expect(meta.hasServices).toBe(true);
      expect(meta.servicesCount).toBe(1);
      expect(meta.serviceNames).toContain('math.add');

      const sum = await context.service('math.add', { a: 15, b: 25 });
      expect(sum).toBe(40);

      await teardown();
    });

    it('reloads context safely when reload() is called', async () => {
      const { context, teardown } = await buildConsoleContext({
        rootDir: __dirname,
        env: 'test',
      });

      const reloadResult = await context.reload();
      expect(reloadResult).toBeDefined();
      expect(Array.isArray(reloadResult.models)).toBe(true);
      expect(Array.isArray(reloadResult.services)).toBe(true);

      await teardown();
    });
  });

  describe('3. evaluateInConsole()', () => {
    it('evaluates basic arithmetic expressions and returns stringified output', async () => {
      const { result, output, error } = await evaluateInConsole('40 + 2', {
        useColors: false,
      });

      expect(error).toBeUndefined();
      expect(result).toBe(42);
      expect(output).toContain('42');
    });

    it('supports top-level await in evaluated expressions', async () => {
      const { result, output, error } = await evaluateInConsole(
        'await Promise.resolve("async webspresso")',
        { useColors: false }
      );

      expect(error).toBeUndefined();
      expect(result).toBe('async webspresso');
      expect(output).toContain('async webspresso');
    });

    it('evaluates multi-statement JavaScript blocks', async () => {
      const code = `
        const x = 100;
        const y = 200;
        x + y;
      `;
      const { result, output, error } = await evaluateInConsole(code, {
        useColors: false,
      });

      expect(error).toBeUndefined();
      expect(result).toBe(300);
      expect(output).toContain('300');
    });

    it('accesses preloaded context variables in expressions', async () => {
      const flags = createFeatureFlagManager({
        flags: {
          dark_mode: true,
        },
      });

      const { result, error } = await evaluateInConsole(
        'flags.isEnabled("dark_mode")',
        { flags, useColors: false }
      );

      expect(error).toBeUndefined();
      expect(result).toBe(true);
    });

    it('captures errors gracefully on syntax or execution failure', async () => {
      const { result, error } = await evaluateInConsole('throw new Error("test crash")', {
        useColors: false,
      });

      expect(result).toBeUndefined();
      expect(error).toBeDefined();
      expect(error.message).toBe('test crash');
    });
  });

  describe('4. startConsole() & Custom REPL Commands', () => {
    it('starts REPL session with custom stream and registers dot commands', async () => {
      const inputStream = new PassThrough();
      const outputStream = new PassThrough();

      let outputBuffer = '';
      outputStream.on('data', (chunk) => {
        outputBuffer += chunk.toString();
      });

      const session = await startConsole({
        input: inputStream,
        output: outputStream,
        banner: false,
        history: false,
        useColors: false,
        env: 'test',
      });

      expect(session.replServer).toBeDefined();
      expect(session.context).toBeDefined();
      expect(session.meta).toBeDefined();

      const commands = session.replServer.commands;
      expect(commands).toHaveProperty('models');
      expect(commands).toHaveProperty('services');
      expect(commands).toHaveProperty('routes');
      expect(commands).toHaveProperty('flags');
      expect(commands).toHaveProperty('reload');

      // Execute .models command
      commands.models.action.call(session.replServer);
      expect(outputBuffer).toBeDefined();

      // Execute .flags command
      commands.flags.action.call(session.replServer);

      // Close session
      session.replServer.close();
      await session.teardown();
    });
  });

  describe('5. CLI Command Registration (bin/commands/console.js)', () => {
    it('registers console command and c alias on commander program', () => {
      const { Command } = require('commander');
      const { registerCommand } = require('../../bin/commands/console');
      const testProgram = new Command();
      registerCommand(testProgram);

      const cmd = testProgram.commands.find((c) => c.name() === 'console');
      expect(cmd).toBeDefined();
      expect(cmd.alias()).toBe('c');
      expect(cmd.description()).toContain('interactive Webspresso REPL');

      const options = cmd.options.map((o) => o.long);
      expect(options).toContain('--eval');
      expect(options).toContain('--env');
      expect(options).toContain('--config');
      expect(options).toContain('--no-history');
      expect(options).toContain('--no-banner');
    });
  });
});

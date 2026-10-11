import { describe, it, expect, vi } from 'vitest';
const { Command } = require('commander');
const { registerCommand } = require('../../../bin/commands/routes');

describe('bin/commands/routes', () => {
  it('registers the routes command on commander program', () => {
    const program = new Command();
    registerCommand(program);

    const routesCmd = program.commands.find((c) => c.name() === 'routes');
    expect(routesCmd).toBeDefined();
    expect(routesCmd.description()).toContain('routes');
  });

  it('outputs formatted route table to console.log', () => {
    const program = new Command();
    registerCommand(program);

    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      program.parse(['node', 'webspresso', 'routes', '--root', process.cwd()]);
      const joined = logs.join('\n');
      expect(joined).toContain('Discovered Routes');
      expect(joined).toContain('/api/health');
    } finally {
      console.log = origLog;
    }
  });

  it('outputs JSON when --json flag is passed', () => {
    const program = new Command();
    registerCommand(program);

    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      program.parse(['node', 'webspresso', 'routes', '--json', '--root', process.cwd()]);
      const jsonStr = logs.find((l) => l.trim().startsWith('[') && l.trim().endsWith(']'));
      expect(jsonStr).toBeDefined();
      const parsed = JSON.parse(jsonStr);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.some((r) => r.path === '/api/health')).toBe(true);
    } finally {
      console.log = origLog;
    }
  });

  it('filters routes when --api or --pages flags are used', () => {
    const program = new Command();
    registerCommand(program);

    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      program.parse(['node', 'webspresso', 'routes', '--api', '--json', '--root', process.cwd()]);
      const jsonStr = logs.find((l) => l.trim().startsWith('[') && l.trim().endsWith(']'));
      expect(jsonStr).toBeDefined();
      const parsed = JSON.parse(jsonStr);
      expect(parsed.every((r) => r.type === 'api' || r.path.startsWith('/api'))).toBe(true);
    } finally {
      console.log = origLog;
    }
  });
});

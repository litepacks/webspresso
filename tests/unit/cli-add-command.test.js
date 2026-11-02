/**
 * `webspresso add <integration>` must route each integration to its own handler.
 * Regression: `add tailwind` and `add esbuild` were both registered as a top-level
 * `add` command, so `add esbuild` ran the Tailwind handler and `add:tailwind`
 * demanded a positional argument.
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';

const { Command } = require('commander');
const { registerCommand: registerAddTailwind } = require('../../bin/commands/add-tailwind');
const { registerCommand: registerAddEsbuild } = require('../../bin/commands/add-esbuild');

function buildProgram() {
  const program = new Command();
  registerAddTailwind(program);
  registerAddEsbuild(program);
  return program;
}

describe('CLI add command registration', () => {
  it('registers a single `add` parent with tailwind and esbuild subcommands', () => {
    const program = buildProgram();
    const addCommands = program.commands.filter((cmd) => cmd.name() === 'add');
    expect(addCommands).toHaveLength(1);

    const subNames = addCommands[0].commands.map((cmd) => cmd.name()).sort();
    expect(subNames).toEqual(['esbuild', 'tailwind']);
  });

  it('registers colon forms without required positional arguments', () => {
    const program = buildProgram();
    for (const name of ['add:tailwind', 'add:esbuild']) {
      const cmd = program.commands.find((c) => c.name() === name);
      expect(cmd, name).toBeDefined();
      expect(cmd.registeredArguments.filter((arg) => arg.required)).toHaveLength(0);
    }
  });

  it('keeps tailwind options on both forms', () => {
    const program = buildProgram();
    const colonForm = program.commands.find((c) => c.name() === 'add:tailwind');
    const subForm = program.commands.find((c) => c.name() === 'add').commands.find((c) => c.name() === 'tailwind');
    for (const cmd of [colonForm, subForm]) {
      expect(cmd.options.map((o) => o.long)).toEqual(expect.arrayContaining(['--v4', '--v3', '--upgrade']));
    }
  });
});

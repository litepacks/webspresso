/**
 * Shared `add` parent command
 * Lets integrations register as `webspresso add <name>` subcommands without
 * colliding with each other (each also registers its own `add:<name>` form).
 */

function getAddCommand(program) {
  const existing = program.commands.find((cmd) => cmd.name() === 'add');
  if (existing) return existing;

  return program
    .command('add')
    .description('Add an integration to the project (e.g. add tailwind, add esbuild)');
}

module.exports = { getAddCommand };

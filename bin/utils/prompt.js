/**
 * Shared lazy ESM loader for Inquirer v13+ in CommonJS CLI commands.
 */
let _inquirer;

const inquirer = {
  async prompt(...args) {
    if (!_inquirer) {
      const mod = await import('inquirer');
      _inquirer = mod.default || mod;
    }
    return _inquirer.prompt(...args);
  },
};

module.exports = inquirer;


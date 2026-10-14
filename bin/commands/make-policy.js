'use strict';

/**
 * Webspresso CLI - make:policy Command
 * Scaffolds an authorization policy in policies/<name>.policy.js
 * @module bin/commands/make-policy
 */

const fs = require('fs');
const path = require('path');

function generatePolicyContent(policyName) {
  const modelName = policyName.replace(/policy$/i, '').trim();
  const cleanName = modelName.charAt(0).toUpperCase() + modelName.slice(1);

  return `'use strict';

/**
 * Authorization Policy: ${cleanName}
 * Invoked via req.bouncer.authorize('${cleanName.toLowerCase()}.update', record)
 * or {% if fsy.can('${cleanName.toLowerCase()}.update', record) %}
 */
module.exports = {
  name: '${cleanName.toLowerCase()}',

  /**
   * Determine whether the user can view any records
   */
  async viewAny(user) {
    return true;
  },

  /**
   * Determine whether the user can view the specific record
   */
  async view(user, record) {
    return true;
  },

  /**
   * Determine whether the user can create records
   */
  async create(user) {
    return Boolean(user);
  },

  /**
   * Determine whether the user can update the record
   */
  async update(user, record) {
    if (!user) return false;
    if (user.isAdmin || user.role === 'admin') return true;
    return record && (record.userId === user.id || record.user_id === user.id);
  },

  /**
   * Determine whether the user can delete the record
   */
  async delete(user, record) {
    if (!user) return false;
    return Boolean(user.isAdmin || user.role === 'admin');
  },
};
`;
}

function registerCommand(program) {
  program
    .command('make:policy <name>')
    .alias('policy:make')
    .description('Scaffold an authorization policy in policies/<name>.policy.js')
    .option('--root <dir>', 'Root directory of the project', process.cwd())
    .action((nameArg, options) => {
      const rootDir = path.resolve(options.root || process.cwd());
      const policiesDir = path.join(rootDir, 'policies');

      if (!fs.existsSync(policiesDir)) {
        fs.mkdirSync(policiesDir, { recursive: true });
      }

      const rawName = String(nameArg || '').trim();
      if (!rawName) {
        console.error('❌ Policy name is required.');
        process.exitCode = 1;
        return;
      }

      const policyBase = rawName.replace(/\.policy(\.js)?$/, '').replace(/\.js$/, '');
      const targetFilePath = path.join(policiesDir, `${policyBase}.policy.js`);

      if (fs.existsSync(targetFilePath)) {
        console.error(`❌ Policy file already exists: ${path.relative(rootDir, targetFilePath)}`);
        process.exitCode = 1;
        return;
      }

      const content = generatePolicyContent(policyBase);
      fs.writeFileSync(targetFilePath, content, 'utf-8');
      console.log(`\n✅ Created authorization policy: ${path.relative(rootDir, targetFilePath)}\n`);
    });
}

module.exports = {
  registerCommand,
  generatePolicyContent,
};

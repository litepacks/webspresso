#!/usr/bin/env node

/**
 * Webspresso CLI
 * Command-line interface for Webspresso framework
 */

const { program } = require('commander');

program
  .name('webspresso')
  .description('Webspresso CLI - Minimal file-based SSR framework')
  .version(require('../package.json').version);

// Register commands
const { registerCommand: registerNew } = require('./commands/new');
const { registerCommand: registerPage } = require('./commands/page');
const { registerCommand: registerApi } = require('./commands/api');
const { registerCommand: registerDev } = require('./commands/dev');
const { registerCommand: registerStart } = require('./commands/start');
const { registerCommand: registerAddTailwind } = require('./commands/add-tailwind');
const { registerCommand: registerDbMigrate } = require('./commands/db-migrate');
const { registerCommand: registerDbRollback } = require('./commands/db-rollback');
const { registerCommand: registerDbStatus } = require('./commands/db-status');
const { registerCommand: registerDbMake } = require('./commands/db-make');
const { registerCommand: registerSeed } = require('./commands/seed');
const { registerCommand: registerAdminSetup } = require('./commands/admin-setup');
const { registerCommand: registerAdminPassword } = require('./commands/admin-password');
const { registerCommand: registerFaviconGenerate } = require('./commands/favicon-generate');
const { registerCommand: registerAuditPrune } = require('./commands/audit-prune');
const { registerCommand: registerDoctor } = require('./commands/doctor');
const { registerCommand: registerSkill } = require('./commands/skill');
const { registerCommand: registerUpgrade } = require('./commands/upgrade');

registerNew(program);
registerPage(program);
registerApi(program);
registerDev(program);
registerStart(program);
registerAddTailwind(program);
registerDbMigrate(program);
registerDbRollback(program);
registerDbStatus(program);
registerDbMake(program);
registerSeed(program);
registerAdminSetup(program);
registerAdminPassword(program);
registerFaviconGenerate(program);
registerAuditPrune(program);
registerDoctor(program);
registerSkill(program);
registerUpgrade(program);

// Parse arguments
program.parse();

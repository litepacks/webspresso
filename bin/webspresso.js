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
const { registerCommand: registerBuild } = require('./commands/build');
const { registerCommand: registerAddTailwind } = require('./commands/add-tailwind');
const { registerCommand: registerAddEsbuild } = require('./commands/add-esbuild');
const { registerCommand: registerDbMigrate } = require('./commands/db-migrate');
const { registerCommand: registerDbRollback } = require('./commands/db-rollback');
const { registerCommand: registerDbStatus } = require('./commands/db-status');
const { registerCommand: registerDbMake } = require('./commands/db-make');
const { registerCommand: registerDbScaffold } = require('./commands/db-scaffold');
const { registerCommand: registerSeed } = require('./commands/seed');
const { registerCommand: registerAdminSetup } = require('./commands/admin-setup');
const { registerCommand: registerAdminPassword } = require('./commands/admin-password');
const { registerCommand: registerFaviconGenerate } = require('./commands/favicon-generate');
const { registerCommand: registerAuditPrune } = require('./commands/audit-prune');
const { registerCommand: registerAnalyticsPrune } = require('./commands/analytics-prune');
const { registerCommand: registerEmailPrune } = require('./commands/email-prune');
const { registerCommand: registerQueuePrune } = require('./commands/queue-prune');
const { registerCommand: registerUploadPrune } = require('./commands/upload-prune');
const { registerCommand: registerDoctor } = require('./commands/doctor');
const { registerCommand: registerUpgrade } = require('./commands/upgrade');
const { registerCommand: registerOrmMap } = require('./commands/orm-map');
const { registerCommand: registerService } = require('./commands/service');
const { registerCommand: registerMcp } = require('./commands/mcp');
const { registerCommand: registerPolarMigrate } = require('./commands/polar-migrate');
const { registerCommand: registerAgentsInit } = require('./commands/agents-init');
const { registerCommand: registerRoutes } = require('./commands/routes');
const { registerCommand: registerMakeModel } = require('./commands/make-model');
const { registerCommand: registerMakeJob } = require('./commands/make-job');
const { registerCommand: registerOpenapi } = require('./commands/openapi');
const { registerCommand: registerTypegen } = require('./commands/typegen');

registerNew(program);
registerPage(program);
registerApi(program);
registerDev(program);
registerStart(program);
registerBuild(program);
registerAddTailwind(program);
registerAddEsbuild(program);
registerDbMigrate(program);
registerDbRollback(program);
registerDbStatus(program);
registerDbMake(program);
registerDbScaffold(program);
registerSeed(program);
registerAdminSetup(program);
registerAdminPassword(program);
registerFaviconGenerate(program);
registerAuditPrune(program);
registerAnalyticsPrune(program);
registerEmailPrune(program);
registerQueuePrune(program);
registerUploadPrune(program);
registerDoctor(program);
registerUpgrade(program);
registerOrmMap(program);
registerService(program);
registerMcp(program);
registerPolarMigrate(program);
registerAgentsInit(program);
registerRoutes(program);
registerMakeModel(program);
registerMakeJob(program);
registerOpenapi(program);
registerTypegen(program);

// Parse arguments
program.parse();

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
const { registerCommand: registerDbStudio } = require('./commands/db-studio');
const { registerCommand: registerDbMake } = require('./commands/db-make');
const { registerCommand: registerDbScaffold } = require('./commands/db-scaffold');
const { registerCommand: registerDbMakeMigrations } = require('./commands/db-makemigrations');
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
const { registerCommand: registerAddDocker } = require('./commands/add-docker');
const { registerCommand: registerAddCloudflare } = require('./commands/add-cloudflare');
const { registerCommand: registerAddCloudrun } = require('./commands/add-cloudrun');
const { registerCommand: registerAddAws } = require('./commands/add-aws');
const { registerCommand: registerAddCi } = require('./commands/add-ci');
const { registerCommand: registerAddMigrationJob } = require('./commands/add-migration-job');
const { registerCommand: registerAssetsSync } = require('./commands/assets-sync');
const { registerCommand: registerExport } = require('./commands/export');
const { registerCommand: registerDeployCheck } = require('./commands/deploy-check');
const { registerCommand: registerSecretsPull } = require('./commands/secrets-pull');
const { registerCommand: registerRun } = require('./commands/run');
const { registerCommand: registerList } = require('./commands/list');
const { registerCommand: registerMakeCommand } = require('./commands/make-command');
const { registerCommand: registerMakePolicy } = require('./commands/make-policy');
const { registerCommand: registerMakeFactory } = require('./commands/make-factory');
const { registerCommand: registerMakeEvent } = require('./commands/make-event');
const { registerCommand: registerMakeMail } = require('./commands/make-mail');
const { registerCommand: registerClientGen } = require('./commands/client-generate');
const { registerCommand: registerConsole } = require('./commands/console');

registerNew(program);
registerPage(program);
registerApi(program);
registerDev(program);
registerStart(program);
registerBuild(program);
registerExport(program);
registerAddTailwind(program);
registerAddEsbuild(program);
registerAddDocker(program);
registerAddCloudflare(program);
registerAddCloudrun(program);
registerAddAws(program);
registerAddCi(program);
registerAddMigrationJob(program);
registerAssetsSync(program);
registerDbMigrate(program);
registerDbRollback(program);
registerDbStatus(program);
registerDbStudio(program);
registerDbMake(program);
registerDbScaffold(program);
registerDbMakeMigrations(program);
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
registerDeployCheck(program);
registerSecretsPull(program);
registerUpgrade(program);
registerOrmMap(program);
registerService(program);
registerMcp(program);
registerPolarMigrate(program);
registerAgentsInit(program);
registerRoutes(program);
registerMakeModel(program);
registerMakeJob(program);
registerMakeCommand(program);
registerMakePolicy(program);
registerMakeFactory(program);
registerMakeEvent(program);
registerMakeMail(program);
registerRun(program);
registerList(program);
registerOpenapi(program);
registerTypegen(program);
registerClientGen(program);
registerConsole(program);

// Parse arguments
program.parse();


import { createTempDir, cleanupDir } from '../../utils';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');

const { registerCommand: registerMakeModel } = require('../../../bin/commands/make-model');
const { registerCommand: registerMakeJob } = require('../../../bin/commands/make-job');
const { registerCommand: registerApi } = require('../../../bin/commands/api');
const { registerCommand: registerPage } = require('../../../bin/commands/page');
const { registerCommand: registerService } = require('../../../bin/commands/service');

describe('Webspresso make:* CLI Scaffolding Commands', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir('ws-make-test');
  });

  afterEach(() => {
    try {
      cleanupDir(tempDir);
    } catch (_) {}
  });

  describe('make:model', () => {
    it('scaffolds a model with parsed fields and zdb schema', () => {
      const program = new Command();
      registerMakeModel(program);

      program.parse([
        'node', 'webspresso', 'make:model', 'Article',
        '--fields', 'title:string,content:text,published:boolean,views:integer',
        '--root', tempDir,
      ]);

      const modelFile = path.join(tempDir, 'models', 'Article.js');
      expect(fs.existsSync(modelFile)).toBe(true);

      const content = fs.readFileSync(modelFile, 'utf8');
      expect(content).toContain("name: 'Article'");
      expect(content).toContain("table: 'articles'");
      expect(content).toContain('id: zdb.id()');
      expect(content).toContain('title: zdb.string().min(1)');
      expect(content).toContain('content: zdb.text().optional()');
      expect(content).toContain('published: zdb.boolean().defaultTo(false)');
      expect(content).toContain('views: zdb.integer().defaultTo(0)');
      expect(content).toContain('createdAt: zdb.timestamps().createdAt');
    });

    it('generates a Knex migration file when -m/--migration is provided', () => {
      const program = new Command();
      registerMakeModel(program);

      program.parse([
        'node', 'webspresso', 'make:model', 'Product',
        '--fields', 'name:string,price:number',
        '--migration',
        '--root', tempDir,
      ]);

      const migrationsDir = path.join(tempDir, 'migrations');
      expect(fs.existsSync(migrationsDir)).toBe(true);

      const files = fs.readdirSync(migrationsDir);
      const migFile = files.find((f) => f.includes('create_products_table'));
      expect(migFile).toBeDefined();

      const migContent = fs.readFileSync(path.join(migrationsDir, migFile), 'utf8');
      expect(migContent).toContain("knex.schema.createTable('products'");
      expect(migContent).toContain("table.increments('id').primary()");
      expect(migContent).toContain("table.string('name').notNullable()");
      expect(migContent).toContain("table.float('price')");
      expect(migContent).toContain('table.timestamps(true, true)');
    });

    it('supports --soft-deletes flag for deletedAt column and default scope', () => {
      const program = new Command();
      registerMakeModel(program);

      program.parse([
        'node', 'webspresso', 'make:model', 'Comment',
        '--fields', 'text:string',
        '--soft-deletes',
        '--migration',
        '--root', tempDir,
      ]);

      const modelContent = fs.readFileSync(path.join(tempDir, 'models', 'Comment.js'), 'utf8');
      expect(modelContent).toContain('deletedAt: zdb.softDelete().optional()');
      expect(modelContent).toContain("default: (q) => q.whereNull('deletedAt')");

      const files = fs.readdirSync(path.join(tempDir, 'migrations'));
      const migFile = files.find((f) => f.includes('create_comments_table'));
      const migContent = fs.readFileSync(path.join(tempDir, 'migrations', migFile), 'utf8');
      expect(migContent).toContain("table.datetime('deletedAt').nullable()");
    });
  });

  describe('make:api', () => {
    it('scaffolds a single API endpoint with schema and handler', () => {
      const program = new Command();
      registerApi(program);

      program.parse([
        'node', 'webspresso', 'make:api', 'users/profile',
        '--method', 'GET',
        '--auth',
        '--root', tempDir,
      ]);

      const apiFile = path.join(tempDir, 'pages', 'api', 'users', 'profile.get.js');
      expect(fs.existsSync(apiFile)).toBe(true);

      const content = fs.readFileSync(apiFile, 'utf8');
      expect(content).toContain('defineApi');
      expect(content).toContain("middleware: ['auth']");
      expect(content).toContain('schema: ({ z }) =>');
      expect(content).toContain('handler: async (req, res) =>');
    });

    it('scaffolds full REST CRUD suite when --crud is passed', () => {
      const program = new Command();
      registerApi(program);

      program.parse([
        'node', 'webspresso', 'make:api', 'posts',
        '--crud',
        '--root', tempDir,
      ]);

      const apiDir = path.join(tempDir, 'pages', 'api');
      const listFile = path.join(apiDir, 'posts.get.js');
      const createFile = path.join(apiDir, 'posts.post.js');
      const detailFile = path.join(apiDir, 'posts', '[id]', '[id].get.js');
      const updateFile = path.join(apiDir, 'posts', '[id]', '[id].patch.js');
      const deleteFile = path.join(apiDir, 'posts', '[id]', '[id].delete.js');

      expect(fs.existsSync(listFile)).toBe(true);
      expect(fs.existsSync(createFile)).toBe(true);
      expect(fs.existsSync(detailFile)).toBe(true);
      expect(fs.existsSync(updateFile)).toBe(true);
      expect(fs.existsSync(deleteFile)).toBe(true);

      const listContent = fs.readFileSync(listFile, 'utf8');
      expect(listContent).toContain("req.db.getRepository('Post')");
      expect(listContent).toContain('repo.query().paginate');

      const createContent = fs.readFileSync(createFile, 'utf8');
      expect(createContent).toContain("req.db.getRepository('Post')");
      expect(createContent).toContain('repo.create(req.input.body)');

      const detailContent = fs.readFileSync(detailFile, 'utf8');
      expect(detailContent).toContain("req.db.getRepository('Post')");
      expect(detailContent).toContain('repo.findById(req.params.id)');

      const deleteContent = fs.readFileSync(deleteFile, 'utf8');
      expect(deleteContent).toContain('repo.delete(req.params.id)');
      expect(deleteContent).toContain('res.status(204).end()');
    });
  });

  describe('make:page', () => {
    it('scaffolds SSR page template and companion data loader', () => {
      const program = new Command();
      registerPage(program);

      program.parse([
        'node', 'webspresso', 'make:page', 'dashboard/stats',
        '--root', tempDir,
      ]);

      const njkFile = path.join(tempDir, 'pages', 'dashboard', 'stats.njk');
      const loaderFile = path.join(tempDir, 'pages', 'dashboard', 'stats.js');

      expect(fs.existsSync(njkFile)).toBe(true);
      expect(fs.existsSync(loaderFile)).toBe(true);

      const njkContent = fs.readFileSync(njkFile, 'utf8');
      expect(njkContent).toContain('{% extends "layout.njk" %}');

      const loaderContent = fs.readFileSync(loaderFile, 'utf8');
      expect(loaderContent).toContain('async load({ req, res, db, ctx })');
    });

    it('skips companion loader when --no-loader is passed', () => {
      const program = new Command();
      registerPage(program);

      program.parse([
        'node', 'webspresso', 'make:page', 'simple-about',
        '--no-loader',
        '--root', tempDir,
      ]);

      const njkFile = path.join(tempDir, 'pages', 'simple-about.njk');
      const loaderFile = path.join(tempDir, 'pages', 'simple-about.js');

      expect(fs.existsSync(njkFile)).toBe(true);
      expect(fs.existsSync(loaderFile)).toBe(false);
    });
  });

  describe('make:service', () => {
    it('scaffolds service file with transaction wrapper support', () => {
      const program = new Command();
      registerService(program);

      program.parse([
        'node', 'webspresso', 'make:service', 'order.process',
        '--transaction',
        '--auth', 'admin',
        '--root', tempDir,
      ]);

      const serviceFile = path.join(tempDir, 'services', 'order', 'process.js');
      expect(fs.existsSync(serviceFile)).toBe(true);

      const content = fs.readFileSync(serviceFile, 'utf8');
      expect(content).toContain('defineService');
      expect(content).toContain('transaction: true');
      expect(content).toContain("auth: 'admin'");
      expect(content).toContain('schema: z.object');
    });
  });

  describe('make:job', () => {
    it('scaffolds background queue job worker with retries and backoff', () => {
      const program = new Command();
      registerMakeJob(program);

      program.parse([
        'node', 'webspresso', 'make:job', 'notifications/welcome-push',
        '--queue', 'high-priority',
        '--retries', '5',
        '--root', tempDir,
      ]);

      const jobFile = path.join(tempDir, 'jobs', 'notifications', 'welcome-push.js');
      expect(fs.existsSync(jobFile)).toBe(true);

      const content = fs.readFileSync(jobFile, 'utf8');
      expect(content).toContain("name: 'notifications/welcome-push'");
      expect(content).toContain("queue: 'high-priority'");
      expect(content).toContain('retries: 5');
      expect(content).toContain("type: 'exponential'");
      expect(content).toContain('handler: async (payload, ctx) =>');
    });
  });
});

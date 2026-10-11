const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  zodToTsType,
  collectModelMetadata,
  collectServiceMetadata,
  generateDeclarationCode,
  generateTypes,
} = require('../../src/dev/typegen');
const { z } = require('../../core/validation');
const { defineModel, unregisterModel, hasModel } = require('../../core/orm/model');

describe('Webspresso TypeGen Engine', () => {
  describe('zodToTsType()', () => {
    it('should convert primitive Zod types to TypeScript', () => {
      expect(zodToTsType(z.string())).toBe('string');
      expect(zodToTsType(z.number())).toBe('number');
      expect(zodToTsType(z.boolean())).toBe('boolean');
      expect(zodToTsType(z.date())).toBe('Date');
      expect(zodToTsType(z.null())).toBe('null');
      expect(zodToTsType(z.undefined())).toBe('undefined');
      expect(zodToTsType(z.any())).toBe('any');
    });

    it('should convert modifier Zod types (optional, nullable, default)', () => {
      expect(zodToTsType(z.string().optional())).toBe('string | undefined');
      expect(zodToTsType(z.number().nullable())).toBe('number | null');
      expect(zodToTsType(z.boolean().default(true))).toBe('boolean');
    });

    it('should convert collections and literal Zod types', () => {
      expect(zodToTsType(z.array(z.string()))).toBe('Array<string>');
      expect(zodToTsType(z.literal('active'))).toBe("'active'");
      expect(zodToTsType(z.literal(42))).toBe('42');
      expect(zodToTsType(z.enum(['pending', 'completed']))).toBe("'pending' | 'completed'");
      expect(zodToTsType(z.union([z.string(), z.number()]))).toBe('string | number');
      expect(zodToTsType(z.record(z.string(), z.number()))).toBe('Record<string, number>');
    });

    it('should convert complex Zod object schemas', () => {
      const schema = z.object({
        id: z.number(),
        title: z.string(),
        tags: z.array(z.string()),
        status: z.enum(['draft', 'published']),
        meta: z.object({ viewCount: z.number() }).optional(),
      });

      const ts = zodToTsType(schema);
      expect(ts).toContain('id: number;');
      expect(ts).toContain('title: string;');
      expect(ts).toContain('tags: Array<string>;');
      expect(ts).toContain("status: 'draft' | 'published';");
      expect(ts).toContain('meta?: {');
      expect(ts).toContain('viewCount: number;');
    });
  });

  describe('generateDeclarationCode() with ORM Models & Services', () => {
    const testModelName = 'TypeGenArticle';

    beforeEach(() => {
      if (hasModel(testModelName)) {
        unregisterModel(testModelName);
      }
      defineModel({
        name: testModelName,
        table: 'typegen_articles',
        schema: z.object({
          title: z.string(),
          content: z.string().optional(),
          views: z.number(),
        }),
        scopes: {
          timestamps: true,
          softDelete: true,
        },
      });
    });

    afterEach(() => {
      if (hasModel(testModelName)) {
        unregisterModel(testModelName);
      }
    });

    it('should generate typed entity interfaces and module augmentation', () => {
      const models = collectModelMetadata();
      const article = models.find((m) => m.name === testModelName);
      expect(article).toBeDefined();

      const services = [
        {
          name: 'article.publish',
          inputTsType: '{\n    articleId: number;\n    notify?: boolean;\n  }',
          hasSchema: true,
        },
      ];

      const routes = [
        { method: 'GET', path: '/api/articles', pattern: '/api/articles' },
        { method: 'POST', path: '/api/articles', pattern: '/api/articles' },
        { method: 'GET', path: '/articles/:id', pattern: '/articles/[id]' },
      ];

      const code = generateDeclarationCode({ models: [article], services, routes });

      expect(code).toContain('export interface TypeGenArticleModel {');
      expect(code).toContain('title: string;');
      expect(code).toContain('content?: string;');
      expect(code).toContain('created_at?: Date;');
      expect(code).toContain('deleted_at?: Date | null;');
      expect(code).toContain("declare module 'webspresso' {");
      expect(code).toContain('TypeGenArticle: TypeGenArticleModel;');
      expect(code).toContain('getRepository<K extends keyof WebspressoModels>');
      expect(code).toContain("'article.publish': {");
      expect(code).toContain('articleId: number;');
      expect(code).toContain("'GET /api/articles'");
      expect(code).toContain("'POST /api/articles'");
      expect(code).toContain("export type AppModelName = keyof import('webspresso').WebspressoModels;");
      expect(code).toContain('export type AppServiceName = keyof WebspressoServicesMap;');
    });
  });

  describe('generateTypes() File Generation', () => {
    let tempDir;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-typegen-test-'));
      // Create minimal structure
      fs.mkdirSync(path.join(tempDir, 'models'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'services', 'user'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'pages', 'api'), { recursive: true });

      // Service sample with ({ z }) => ({ ... })
      fs.writeFileSync(
        path.join(tempDir, 'services', 'user', 'invite.js'),
        `
        module.exports = {
          schema: ({ z }) => ({
            email: z.string(),
            role: z.enum(['admin', 'member'])
          }),
          handler: async () => ({ ok: true })
        };
        `
      );

      // Page sample
      fs.writeFileSync(path.join(tempDir, 'pages', 'index.njk'), '<h1>Home</h1>');
      fs.writeFileSync(
        path.join(tempDir, 'pages', 'api', 'ping.get.js'),
        'module.exports = { handler: (req, res) => res.json({ pong: true }) };'
      );
    });

    afterEach(() => {
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should write .webspresso/types.d.ts and webspresso-env.d.ts', () => {
      const result = generateTypes({
        rootDir: tempDir,
        createEnvFile: true,
        silent: true,
      });

      expect(fs.existsSync(result.outFile)).toBe(true);
      expect(fs.existsSync(result.envFile)).toBe(true);

      const content = fs.readFileSync(result.outFile, 'utf8');
      expect(content).toContain('Webspresso Application Type Definitions');
      expect(content).toContain('user.invite');
      expect(content).toContain("role: 'admin' | 'member';");

      const envContent = fs.readFileSync(result.envFile, 'utf8');
      expect(envContent).toContain('/// <reference path="./.webspresso/types.d.ts" />');
    });

    it('should respect custom output path and noEnvFile flag', () => {
      const customOut = path.join(tempDir, 'custom', 'custom-types.d.ts');
      const result = generateTypes({
        rootDir: tempDir,
        outFile: customOut,
        createEnvFile: false,
        silent: true,
      });

      expect(result.envFile).toBeNull();
      expect(fs.existsSync(customOut)).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'webspresso-env.d.ts'))).toBe(false);
    });
  });

  describe('CLI Command (registerCommand)', () => {
    let tempDir;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-typegen-cli-test-'));
      fs.mkdirSync(path.join(tempDir, 'models'), { recursive: true });
    });

    afterEach(() => {
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should run typegen command and generate declarations via commander', () => {
      const { Command } = require('commander');
      const { registerCommand } = require('../../bin/commands/typegen');

      const program = new Command();
      registerCommand(program);

      program.parse([
        'node', 'webspresso', 'typegen',
        '--root', tempDir,
        '--silent',
      ]);

      const expectedOut = path.join(tempDir, '.webspresso', 'types.d.ts');
      const expectedEnv = path.join(tempDir, 'webspresso-env.d.ts');
      expect(fs.existsSync(expectedOut)).toBe(true);
      expect(fs.existsSync(expectedEnv)).toBe(true);
    });
  });
});


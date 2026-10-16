import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import request from 'supertest';
import {
  precompileTemplates,
  loadPrecompiledTemplates,
  DEFAULT_PRECOMPILED_REL_PATH,
} from '../../../src/template/precompile';
import { createApp } from '../../../src/server';

describe('Nunjucks Template Precompilation (AOT & Zero-AST Parsing)', () => {
  const tempDir = path.join(__dirname, '../../fixtures/temp-precompile-' + Date.now());

  beforeEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(tempDir, 'views', 'partials'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'pages'), { recursive: true });

    // Setup layout and partials in views/
    fs.writeFileSync(
      path.join(tempDir, 'views', 'layout.njk'),
      `<!DOCTYPE html><html><head><title>{{ meta.title }}</title></head><body>{% include "partials/nav.njk" %}<main>{% block content %}{% endblock %}</main></body></html>`
    );
    fs.writeFileSync(
      path.join(tempDir, 'views', 'partials', 'nav.njk'),
      `<nav>Site Navigation</nav>`
    );

    // Setup pages with frontmatter
    fs.writeFileSync(
      path.join(tempDir, 'pages', 'index.njk'),
      `---
title: Home Page
---
{% extends "layout.njk" %}
{% block content %}
<h1>Welcome Home</h1>
<p>Hello, {{ user }}!</p>
{% endblock %}`
    );

    // Companion config for index.njk
    fs.writeFileSync(
      path.join(tempDir, 'pages', 'index.js'),
      `module.exports = { load: async () => ({ user: 'Tester' }) };`
    );
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('precompileTemplates should compile all templates into an AOT bundle', () => {
    const result = precompileTemplates({ rootDir: tempDir });

    expect(result.templateCount).toBeGreaterThanOrEqual(3);
    expect(fs.existsSync(result.manifestPath)).toBe(true);

    const bundle = result.bundle;
    expect(bundle.version).toBe(1);
    expect(typeof bundle.generatedAt).toBe('string');
    expect(typeof bundle.templates).toBe('object');

    // Verify templates are compiled
    expect(bundle.templates['layout.njk']).toBeDefined();
    expect(bundle.templates['partials/nav.njk']).toBeDefined();
    expect(bundle.templates['index.njk']).toBeDefined();

    // Verify frontmatter was extracted
    expect(bundle.frontmatter['pages/index.njk']).toBeDefined();
    expect(bundle.frontmatter['pages/index.njk'].metaPatch.title).toBe('Home Page');
  });

  it('loadPrecompiledTemplates should construct a functional PrecompiledLoader', () => {
    precompileTemplates({ rootDir: tempDir });

    const loaded = loadPrecompiledTemplates({ rootDir: tempDir });
    expect(loaded).not.toBeNull();
    expect(loaded.templateCount).toBeGreaterThanOrEqual(3);
    expect(typeof loaded.loader.getSource).toBe('function');

    // Test getSource on precompiled templates
    const source = loaded.loader.getSource('layout.njk');
    expect(source).not.toBeNull();
    expect(source.src.type).toBe('code');
    expect(typeof source.src.obj.root).toBe('function');
  });

  it('loadPrecompiledTemplates should return null if bundle does not exist', () => {
    const loaded = loadPrecompiledTemplates({ rootDir: path.join(tempDir, 'non-existent') });
    expect(loaded).toBeNull();
  });

  it('createApp should render pages using precompiled templates with zero AST compile', async () => {
    // 1. Generate precompiled bundle
    precompileTemplates({ rootDir: tempDir });

    // 2. Start app with precompiledTemplates: true
    const { app } = createApp({
      rootDir: tempDir,
      viewsDir: path.join(tempDir, 'views'),
      pagesDir: path.join(tempDir, 'pages'),
      precompiledTemplates: true,
      logging: false,
    });

    expect(app.precompiledTemplates).toBeDefined();

    // 3. Render page
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<title>Home Page</title>');
    expect(res.text).toContain('<nav>Site Navigation</nav>');
    expect(res.text).toContain('<h1>Welcome Home</h1>');
    expect(res.text).toContain('<p>Hello, Tester!</p>');
  });

  it('createApp should support custom precompiled bundle path', async () => {
    const customBundlePath = path.join(tempDir, 'custom-bundle.js');
    precompileTemplates({ rootDir: tempDir, outFile: customBundlePath });

    const { app } = createApp({
      rootDir: tempDir,
      viewsDir: path.join(tempDir, 'views'),
      pagesDir: path.join(tempDir, 'pages'),
      precompiledTemplates: customBundlePath,
      logging: false,
    });

    expect(app.precompiledTemplates).toBeDefined();

    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Welcome Home');
  });

  it('createApp should fall back to standard loader when precompiledTemplates: false', async () => {
    precompileTemplates({ rootDir: tempDir });

    const { app } = createApp({
      rootDir: tempDir,
      viewsDir: path.join(tempDir, 'views'),
      pagesDir: path.join(tempDir, 'pages'),
      precompiledTemplates: false,
      logging: false,
    });

    expect(app.precompiledTemplates).toBeUndefined();

    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Welcome Home');
  });

  it('build CLI command should generate precompiled templates bundle', async () => {
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'precompile-app' }));

    const { registerCommand } = require('../../../bin/commands/build');
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    let actionFn = null;
    const mockProgram = {
      command: () => mockProgram,
      alias: () => mockProgram,
      description: () => mockProgram,
      option: () => mockProgram,
      action: (fn) => { actionFn = fn; return mockProgram; },
    };

    registerCommand(mockProgram);

    const origCwd = process.cwd();
    try {
      process.chdir(tempDir);
      await actionFn({ css: false, js: false, routes: false });
    } finally {
      process.chdir(origCwd);
      console.log = origLog;
    }

    const compiledPath = path.join(tempDir, DEFAULT_PRECOMPILED_REL_PATH);
    expect(fs.existsSync(compiledPath)).toBe(true);
    expect(logs.some((l) => l.includes('Precompiled Nunjucks templates'))).toBe(true);
  });
});

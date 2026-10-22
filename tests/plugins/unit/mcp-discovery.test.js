/**
 * Unit tests for MCP Directory & Component Discovery
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { discoverMcpDirectory, scanModuleDir } from '../../../plugins/mcp/discovery';

describe('MCP Directory Auto-Discovery', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-disc-test-'));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('scanModuleDir', () => {
    it('returns empty array when directory does not exist', () => {
      const items = scanModuleDir(path.join(tmpDir, 'nonexistent'));
      expect(items).toEqual([]);
    });

    it('scans .js and .cjs files and ignores private/hidden files', () => {
      const subDir = path.join(tmpDir, 'modules');
      fs.mkdirSync(subDir, { recursive: true });

      // Valid tool module
      fs.writeFileSync(
        path.join(subDir, 'my-tool.js'),
        'module.exports = { handler: () => "tool" };',
        'utf8'
      );

      // Valid cjs module with custom name
      fs.writeFileSync(
        path.join(subDir, 'custom.cjs'),
        'module.exports = { name: "explicit-name", handler: () => "cjs" };',
        'utf8'
      );

      // Private files starting with _ or .
      fs.writeFileSync(path.join(subDir, '_ignored.js'), 'module.exports = {};', 'utf8');
      fs.writeFileSync(path.join(subDir, '.hidden.js'), 'module.exports = {};', 'utf8');
      fs.writeFileSync(path.join(subDir, 'notes.txt'), 'text', 'utf8');

      const items = scanModuleDir(subDir);
      expect(items).toHaveLength(2);

      const myTool = items.find((i) => i.name === 'my-tool');
      expect(myTool).toBeDefined();
      expect(typeof myTool.handler).toBe('function');

      const explicit = items.find((i) => i.name === 'explicit-name');
      expect(explicit).toBeDefined();
    });

    it('handles syntax errors gracefully with console.warn', () => {
      const subDir = path.join(tmpDir, 'broken');
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, 'broken.js'), 'const a = ;', 'utf8');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const items = scanModuleDir(subDir);

      expect(items).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[mcp-discovery] Failed to load module'),
        expect.any(String)
      );
      warnSpy.mockRestore();
    });
  });

  describe('discoverMcpDirectory', () => {
    it('returns early when root mcp directory does not exist', () => {
      const mockServer = {
        registerTool: vi.fn(),
        registerResource: vi.fn(),
        registerResourceTemplate: vi.fn(),
        registerPrompt: vi.fn(),
      };

      discoverMcpDirectory(mockServer, tmpDir, 'mcp');
      expect(mockServer.registerTool).not.toHaveBeenCalled();
    });

    it('discovers and registers custom tools, resources, templates, and prompts', () => {
      const mcpRoot = path.join(tmpDir, 'mcp');
      const toolsDir = path.join(mcpRoot, 'tools');
      const resourcesDir = path.join(mcpRoot, 'resources');
      const promptsDir = path.join(mcpRoot, 'prompts');

      fs.mkdirSync(toolsDir, { recursive: true });
      fs.mkdirSync(resourcesDir, { recursive: true });
      fs.mkdirSync(promptsDir, { recursive: true });

      // 1. Tool
      fs.writeFileSync(
        path.join(toolsDir, 'calculate.js'),
        'module.exports = { name: "calc", description: "Calculator", handler: () => 42 };',
        'utf8'
      );

      // Tool without handler should be ignored
      fs.writeFileSync(
        path.join(toolsDir, 'no-handler.js'),
        'module.exports = { name: "invalid" };',
        'utf8'
      );

      // 2. Resource & Resource Template
      fs.writeFileSync(
        path.join(resourcesDir, 'static-doc.js'),
        'module.exports = { uri: "docs://main", handler: () => "doc" };',
        'utf8'
      );
      fs.writeFileSync(
        path.join(resourcesDir, 'template-doc.js'),
        'module.exports = { uriTemplate: "docs://{id}", handler: () => "item" };',
        'utf8'
      );

      // 3. Prompt
      fs.writeFileSync(
        path.join(promptsDir, 'code-review.js'),
        'module.exports = { name: "review", handler: () => ({ messages: [] }) };',
        'utf8'
      );

      const mockServer = {
        registerTool: vi.fn(),
        registerResource: vi.fn(),
        registerResourceTemplate: vi.fn(),
        registerPrompt: vi.fn(),
      };

      discoverMcpDirectory(mockServer, tmpDir, 'mcp');

      expect(mockServer.registerTool).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'calc' })
      );
      expect(mockServer.registerTool).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: 'invalid' })
      );

      expect(mockServer.registerResource).toHaveBeenCalledWith(
        expect.objectContaining({ uri: 'docs://main' })
      );
      expect(mockServer.registerResourceTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ uriTemplate: 'docs://{id}' })
      );

      expect(mockServer.registerPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'review' })
      );
    });
  });
});

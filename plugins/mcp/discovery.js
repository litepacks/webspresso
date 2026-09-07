/**
 * Webspresso MCP File-Based Auto-Discovery
 * Discovers custom MCP tools, resources, and prompts from project `mcp/` directory
 * @module plugins/mcp/discovery
 */

const fs = require('fs');
const path = require('path');

/**
 * Scan a directory for JS files and require them
 * @param {string} dirPath
 * @returns {Array<Object>}
 */
function scanModuleDir(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.cjs'))) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      const fullPath = path.join(dirPath, entry.name);
      try {
        const mod = require(fullPath);
        if (mod && typeof mod === 'object') {
          // If mod doesn't have a name, default to filename without extension
          if (!mod.name && !mod.uri) {
            const baseName = path.basename(entry.name, path.extname(entry.name));
            mod.name = baseName;
          }
          items.push(mod);
        }
      } catch (err) {
        console.warn(`[mcp-discovery] Failed to load module at ${fullPath}:`, err.message);
      }
    }
  }

  return items;
}

/**
 * Discovers custom MCP components from the filesystem and registers them to the server
 * @param {import('./server').McpServer} server
 * @param {string} [rootDir=process.cwd()]
 * @param {string} [mcpDirName='mcp']
 */
function discoverMcpDirectory(server, rootDir = process.cwd(), mcpDirName = 'mcp') {
  const mcpRoot = path.resolve(rootDir, mcpDirName);
  if (!fs.existsSync(mcpRoot)) return;

  // 1. Discover custom tools: mcp/tools/
  const toolsDir = path.join(mcpRoot, 'tools');
  const customTools = scanModuleDir(toolsDir);
  for (const tool of customTools) {
    if (typeof tool.handler === 'function') {
      server.registerTool(tool);
    }
  }

  // 2. Discover custom resources: mcp/resources/
  const resourcesDir = path.join(mcpRoot, 'resources');
  const customResources = scanModuleDir(resourcesDir);
  for (const res of customResources) {
    if (typeof res.handler === 'function') {
      if (res.uriTemplate) {
        server.registerResourceTemplate(res);
      } else if (res.uri) {
        server.registerResource(res);
      }
    }
  }

  // 3. Discover custom prompts: mcp/prompts/
  const promptsDir = path.join(mcpRoot, 'prompts');
  const customPrompts = scanModuleDir(promptsDir);
  for (const prompt of customPrompts) {
    if (typeof prompt.handler === 'function') {
      server.registerPrompt(prompt);
    }
  }
}

module.exports = {
  discoverMcpDirectory,
  scanModuleDir,
};

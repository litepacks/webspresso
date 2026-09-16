'use strict';

/**
 * Agents Init Command
 * Scaffold and synchronize AI Agent guidelines (.agents/, AGENTS.md, CLAUDE.md, .cursorrules)
 * @module bin/commands/agents-init
 */

const fs = require('fs');
const path = require('path');

const SOURCE_ROOT = path.resolve(__dirname, '../../');
const SOURCE_AGENTS_DIR = path.join(SOURCE_ROOT, '.agents');
const SOURCE_AGENTS_MD = path.join(SOURCE_ROOT, 'AGENTS.md');
const SOURCE_CLAUDE_MD = path.join(SOURCE_ROOT, 'CLAUDE.md');
const SOURCE_CURSORRULES = path.join(SOURCE_ROOT, '.cursorrules');

/**
 * Copies a file if force is true or if target file does not exist.
 * @param {string} src
 * @param {string} dest
 * @param {boolean} force
 * @returns {'created'|'overwritten'|'skipped'}
 */
function copyFileSafe(src, dest, force = false) {
  if (!fs.existsSync(src)) return 'skipped';
  const destExists = fs.existsSync(dest);

  if (destExists && !force) {
    return 'skipped';
  }

  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  fs.copyFileSync(src, dest);
  return destExists ? 'overwritten' : 'created';
}

/**
 * Recursively copies a directory safely.
 * @param {string} srcDir
 * @param {string} destDir
 * @param {boolean} force
 * @param {string[]} installed
 * @param {string[]} skipped
 * @param {string} baseRel
 */
function copyDirSafe(srcDir, destDir, force = false, installed = [], skipped = [], baseRel = '') {
  if (!fs.existsSync(srcDir)) return;
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    const relPath = path.join(baseRel, entry.name);

    if (entry.isDirectory()) {
      copyDirSafe(srcPath, destPath, force, installed, skipped, relPath);
    } else {
      const status = copyFileSafe(srcPath, destPath, force);
      if (status === 'created' || status === 'overwritten') {
        installed.push(relPath);
      } else {
        skipped.push(relPath);
      }
    }
  }
}

/**
 * Scaffolds AI Agent rules and guidebook files into target project directory.
 * @param {string} targetDir
 * @param {Object} [options]
 * @param {boolean} [options.force=false]
 * @param {boolean} [options.claude=true]
 * @param {boolean} [options.cursor=true]
 * @param {boolean} [options.guides=true]
 * @returns {{ installed: string[], skipped: string[], errors: string[] }}
 */
function scaffoldAgentsFiles(targetDir, options = {}) {
  const force = options.force === true;
  const includeClaude = options.claude !== false;
  const includeCursor = options.cursor !== false;
  const includeGuides = options.guides !== false;

  const result = {
    installed: [],
    skipped: [],
    errors: [],
  };

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // 1. Root AGENTS.md
  if (fs.existsSync(SOURCE_AGENTS_MD)) {
    const destAgentsMd = path.join(targetDir, 'AGENTS.md');
    const status = copyFileSafe(SOURCE_AGENTS_MD, destAgentsMd, force);
    if (status === 'created' || status === 'overwritten') {
      result.installed.push('AGENTS.md');
    } else {
      result.skipped.push('AGENTS.md');
    }
  }

  // 2. CLAUDE.md
  if (includeClaude && fs.existsSync(SOURCE_CLAUDE_MD)) {
    const destClaudeMd = path.join(targetDir, 'CLAUDE.md');
    const status = copyFileSafe(SOURCE_CLAUDE_MD, destClaudeMd, force);
    if (status === 'created' || status === 'overwritten') {
      result.installed.push('CLAUDE.md');
    } else {
      result.skipped.push('CLAUDE.md');
    }
  }

  // 3. .cursorrules
  if (includeCursor && fs.existsSync(SOURCE_CURSORRULES)) {
    const destCursor = path.join(targetDir, '.cursorrules');
    const status = copyFileSafe(SOURCE_CURSORRULES, destCursor, force);
    if (status === 'created' || status === 'overwritten') {
      result.installed.push('.cursorrules');
    } else {
      result.skipped.push('.cursorrules');
    }
  }

  // 4. .agents/*.md Guidebook and skills/ directory
  if (includeGuides && fs.existsSync(SOURCE_AGENTS_DIR)) {
    const destAgentsDir = path.join(targetDir, '.agents');
    if (!fs.existsSync(destAgentsDir)) {
      fs.mkdirSync(destAgentsDir, { recursive: true });
    }

    const entries = fs.readdirSync(SOURCE_AGENTS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'internal') continue; // exclude internal reviews from user projects
      const srcPath = path.join(SOURCE_AGENTS_DIR, entry.name);
      const destPath = path.join(destAgentsDir, entry.name);
      const relPath = path.join('.agents', entry.name);

      if (entry.isDirectory()) {
        copyDirSafe(srcPath, destPath, force, result.installed, result.skipped, relPath);
      } else if (entry.name.endsWith('.md')) {
        const status = copyFileSafe(srcPath, destPath, force);
        if (status === 'created' || status === 'overwritten') {
          result.installed.push(relPath);
        } else {
          result.skipped.push(relPath);
        }
      }
    }
  }

  return result;
}

function registerCommand(program) {
  program
    .command('agents:init')
    .alias('agents')
    .alias('agents:setup')
    .alias('ai:init')
    .description('Scaffold AI Agent guidelines (.agents/, AGENTS.md, CLAUDE.md, .cursorrules)')
    .option('-p, --path <path>', 'Target project directory', process.cwd())
    .option('-f, --force', 'Overwrite existing agent guideline files', false)
    .option('--no-claude', 'Skip generating CLAUDE.md')
    .option('--no-cursor', 'Skip generating .cursorrules')
    .option('--no-guides', 'Skip generating .agents/ topic guide bundle')
    .action(async (options) => {
      const targetDir = path.resolve(options.path || process.cwd());
      console.log(`\n🤖 Initializing AI Agent Guidelines in: ${targetDir}\n`);

      const result = scaffoldAgentsFiles(targetDir, {
        force: options.force,
        claude: options.claude,
        cursor: options.cursor,
        guides: options.guides,
      });

      if (result.installed.length > 0) {
        console.log('✅ Installed/Updated:');
        for (const file of result.installed) {
          console.log(`   + ${file}`);
        }
      }

      if (result.skipped.length > 0) {
        console.log('\n⚠️  Skipped (already exists, use --force to overwrite):');
        for (const file of result.skipped) {
          console.log(`   - ${file}`);
        }
      }

      console.log('\n🎉 AI Agent Guidelines ready! Agents (Cursor, Claude Code, Antigravity) will follow strict Webspresso standards.\n');
    });
}

module.exports = {
  registerCommand,
  scaffoldAgentsFiles,
};

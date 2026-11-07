#!/usr/bin/env node

/**
 * Webspresso JEV Audit Engine (Judge - Evaluate - Verify)
 * 
 * Token-efficient, programmatic inspection of framework promises vs actual implementation.
 * Evaluates:
 *  1. API Surface & Typings Parity (index.js <-> index.d.ts)
 *  2. Plugin Ecosystem Health & Test Coverage
 *  3. CLI Commands Registration & Documentation Sync
 *  4. Core Architecture Pillars & Topic Guides
 *  5. Code Debt, Stubs & Deprecation Traps
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function runAudit() {
  const findings = {
    p0_critical: [],
    p1_warnings: [],
    p2_improvements: [],
    stats: {},
  };

  // =========================================================================
  // 1. API SURFACE & TYPINGS PARITY
  // =========================================================================
  const rootExports = require(path.join(ROOT, 'index.js'));
  const rootKeys = new Set(Object.keys(rootExports));
  findings.stats.totalRuntimeExports = rootKeys.size;

  const dtsContent = fs.readFileSync(path.join(ROOT, 'index.d.ts'), 'utf8');

  // Extract all top-level symbols declared in index.d.ts
  const declaredInDts = new Set();
  const dtsRegex = /export\s+(?:declare\s+)?(?:function|const|class)\s+([A-Za-z0-9_$]+)/g;
  let match;
  while ((match = dtsRegex.exec(dtsContent)) !== null) {
    declaredInDts.add(match[1]);
  }
  findings.stats.totalDeclaredTypes = declaredInDts.size;

  // Typings declared but not exported in index.js (Phantom types)
  const phantomInDts = [];
  for (const sym of declaredInDts) {
    if (!rootKeys.has(sym)) {
      phantomInDts.push(sym);
    }
  }

  if (phantomInDts.length > 0) {
    findings.p0_critical.push({
      category: 'Contract Drift (Typings without Runtime Export)',
      count: phantomInDts.length,
      symbols: phantomInDts,
      remediation: 'Export missing symbols in index.js or scope them as internal in index.d.ts.',
    });
  }

  // =========================================================================
  // 2. PLUGINS AUDIT
  // =========================================================================
  const pluginsDir = path.join(ROOT, 'plugins');
  const plugins = fs.readdirSync(pluginsDir).filter((f) => {
    return fs.statSync(path.join(pluginsDir, f)).isDirectory();
  });
  findings.stats.totalPlugins = plugins.length;

  const testsDir = path.join(ROOT, 'tests');
  function getAllTestFiles(dir) {
    let files = [];
    for (const item of fs.readdirSync(dir)) {
      const full = path.join(dir, item);
      if (fs.statSync(full).isDirectory()) {
        if (item !== 'node_modules' && item !== '.git') {
          files = files.concat(getAllTestFiles(full));
        }
      } else if (item.endsWith('.test.js') || item.endsWith('.spec.js')) {
        files.push(full);
      }
    }
    return files;
  }
  const allTests = getAllTestFiles(testsDir);
  findings.stats.totalTestFiles = allTests.length;

  const unexportedPlugins = [];
  const untestedPlugins = [];

  for (const p of plugins) {
    const camel = p.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + 'Plugin';
    const isExported =
      rootKeys.has(camel) ||
      rootKeys.has(p) ||
      (rootExports.plugins && camel in rootExports.plugins);

    if (!isExported) {
      unexportedPlugins.push(p);
    }

    const clean = p.replace(/-/g, '').toLowerCase();
    const hasTest = allTests.some((t) => t.toLowerCase().includes(clean) || t.includes(p));
    if (!hasTest) {
      untestedPlugins.push(p);
    }
  }

  if (unexportedPlugins.length > 0) {
    findings.p1_warnings.push({
      category: 'Plugin Public Export Mismatch',
      plugins: unexportedPlugins,
      remediation: 'Export plugin in index.js under consistent camelCase convention.',
    });
  }

  if (untestedPlugins.length > 0) {
    findings.p1_warnings.push({
      category: 'Untested Plugins',
      plugins: untestedPlugins,
      remediation: 'Add unit/integration test file in tests/plugins/.',
    });
  }

  // =========================================================================
  // 3. CLI COMMANDS & DOCUMENTATION PARITY
  // =========================================================================
  const binCommandsDir = path.join(ROOT, 'bin', 'commands');
  const commandFiles = fs.readdirSync(binCommandsDir).filter((f) => f.endsWith('.js')).map((f) => f.replace('.js', ''));
  findings.stats.totalCliCommands = commandFiles.length;

  const cliJsContent = fs.readFileSync(path.join(ROOT, 'bin', 'webspresso.js'), 'utf8');
  const unregisteredCommands = commandFiles.filter((c) => !cliJsContent.includes(c));

  if (unregisteredCommands.length > 0) {
    findings.p0_critical.push({
      category: 'Unregistered CLI Commands in bin/webspresso.js',
      commands: unregisteredCommands,
      remediation: 'Register command in bin/webspresso.js createProgram().',
    });
  }

  const cliGuidePath = path.join(ROOT, '.agents', 'CLI.md');
  if (fs.existsSync(cliGuidePath)) {
    const cliGuide = fs.readFileSync(cliGuidePath, 'utf8');
    const undocumentedCli = commandFiles.filter((c) => {
      const colonVariant = c.replace('-', ':');
      return !cliGuide.includes(c) && !cliGuide.includes(colonVariant);
    });
    if (undocumentedCli.length > 0) {
      findings.p2_improvements.push({
        category: 'Undocumented CLI Commands in .agents/CLI.md',
        count: undocumentedCli.length,
        commands: undocumentedCli,
        remediation: 'Add usage examples in .agents/CLI.md.',
      });
    }
  }

  // =========================================================================
  // 4. CORE TOPIC GUIDES (30 GUIDES)
  // =========================================================================
  const agentsDir = path.join(ROOT, '.agents');
  const guides = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md') && !['AGENTS.md', 'WORKFLOW.md', 'CONVENTIONS.md', 'ARCHITECTURE.md'].includes(f));
  findings.stats.totalTopicGuides = guides.length;

  // =========================================================================
  // 5. HYGIENE & KNOWN TRAPS (express-session defaults)
  // =========================================================================
  const authMiddlewarePath = path.join(ROOT, 'core', 'auth', 'middleware.js');
  if (fs.existsSync(authMiddlewarePath)) {
    const authMw = fs.readFileSync(authMiddlewarePath, 'utf8');
    if (!authMw.includes('resave:') || !authMw.includes('saveUninitialized:')) {
      findings.p1_warnings.push({
        category: 'Express-Session Deprecation Warning Trap',
        file: 'core/auth/middleware.js',
        issue: 'sessionMiddleware config does not explicitly specify resave & saveUninitialized defaults, causing runtime stderr warnings.',
        remediation: 'Set resave: sessionConfig.resave ?? false, saveUninitialized: sessionConfig.saveUninitialized ?? false.',
      });
    }
  }

  return findings;
}

if (require.main === module) {
  const result = runAudit();
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { runAudit };


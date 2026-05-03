/**
 * ORM map — interactive single-page HTML of models and relationships
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { getWebspressoOrmForProject } = require('../utils/resolve-webspresso-orm');
const { loadProjectModels } = require('../utils/orm-map-load');
const { buildSnapshot, buildMermaidErDiagram } = require('../utils/orm-map-snapshot');
const { buildOrmMapHtml, readPackageName } = require('../utils/orm-map-html');

function ensureOpenInsideTrustedRoots(absFile, cwd) {
  if (!fs.existsSync(absFile)) {
    throw new Error(`File does not exist: ${absFile}`);
  }
  let realFile;
  try {
    realFile = fs.realpathSync(absFile);
  } catch (e) {
    throw new Error(`Cannot resolve file path: ${absFile}`, { cause: e });
  }

  /** @type {string[]} */
  const roots = [];
  for (const base of [os.tmpdir(), cwd]) {
    const resolvedBase = path.resolve(base);
    try {
      roots.push(fs.realpathSync(resolvedBase));
    } catch {
      roots.push(resolvedBase);
    }
  }

  const fileNorm = path.normalize(realFile + path.sep);
  const trusted = roots.some((rootRaw) => {
    const rr =
      typeof rootRaw === 'string' && fs.existsSync(rootRaw)
        ? fs.realpathSync(rootRaw)
        : path.normalize(rootRaw);
    const rp = rr.endsWith(path.sep) ? rr : rr + path.sep;
    return realFile === rr || fileNorm.startsWith(path.normalize(rp));
  });

  if (!trusted) {
    throw new Error('Refused to open file outside cwd or OS temp dir');
  }
}

function openFile(filePath, cwd) {
  const fp = path.resolve(filePath);
  ensureOpenInsideTrustedRoots(fp, cwd);
  if (process.platform === 'darwin') {
    execFileSync('open', [fp], { stdio: 'ignore' });
  } else if (process.platform === 'win32') {
    execFileSync('cmd', ['/c', 'start', '', fp], { stdio: 'ignore' });
  } else {
    execFileSync('xdg-open', [fp], { stdio: 'ignore' });
  }
}

function registerCommand(program) {
  program
    .command('orm:map')
    .description(
      'Generate a self-contained HTML map of ORM models and relations (opens in browser by default)',
    )
    .option('-o, --output <file>', 'Write HTML to this path instead of a temp file')
    .option('--no-open', 'Do not open the browser')
    .option('-c, --config <path>', 'Database config file (webspresso.db.js / knexfile.js) for models path')
    .option('-e, --env <environment>', 'Config environment', 'development')
    .option('-m, --models <dir>', 'Models directory (overrides config default ./models)')
    .action((options) => {
      const cwd = process.cwd();
      const { modelsDir, loaded, errors } = loadProjectModels(cwd, {
        modelsOverride: options.models,
        configPath: options.config,
        env: options.env,
      });

      for (const err of errors) {
        if (!err.file) {
          console.error(`❌ ${err.message}`);
        } else {
          console.warn(`⚠️  ${err.file}: ${err.message}`);
        }
      }

      if (loaded.length === 0 && errors.some((e) => e.file === '')) {
        process.exit(1);
      }

      const orm = getWebspressoOrmForProject(cwd);
      const registry = orm.getAllModels();
      if (registry.size === 0) {
        console.error(
          `❌ No models registered. Checked: ${modelsDir}\n` +
            '   Add defineModel() files or pass --models <dir>.',
        );
        process.exit(1);
      }

      const snapshot = buildSnapshot(registry);
      const mermaid = buildMermaidErDiagram(snapshot);
      const pkg = readPackageName(cwd);
      const html = buildOrmMapHtml(snapshot, mermaid, {
        title: 'ORM model map',
        packageName: pkg,
      });

      let outPath;
      if (options.output) {
        outPath = path.resolve(cwd, options.output);
      } else {
        outPath = path.join(
          os.tmpdir(),
          `webspresso-orm-map-${Date.now()}.html`,
        );
      }

      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, html, 'utf8');

      console.log(`\n✅ ORM map (${registry.size} model(s))`);
      console.log(`   Models dir: ${modelsDir}`);
      console.log(`   Written: ${outPath}\n`);

      if (options.open !== false) {
        try {
          openFile(outPath, cwd);
        } catch (e) {
          console.warn(`⚠️  Could not open browser: ${e.message}`);
        }
      }
    });
}

module.exports = { registerCommand };

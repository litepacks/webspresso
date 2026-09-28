/**
 * Build Command
 * Build production assets (Tailwind CSS and esbuild JS bundle with manifest.json)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { buildBundle } = require('../../src/bundle');

function registerCommand(program) {
  program
    .command('build')
    .alias('build:assets')
    .description('Build production assets (Tailwind CSS and esbuild JS with manifest.json)')
    .option('--no-css', 'Skip CSS build')
    .option('--no-js', 'Skip JS bundle build')
    .option('--no-hash', 'Disable content hashing in asset filenames')
    .action(async (options = {}) => {
      const cwd = process.cwd();
      const pkgPath = path.join(cwd, 'package.json');
      if (!fs.existsSync(pkgPath)) {
        console.error('❌ Not a Webspresso project! Run this command in your project directory.');
        process.exit(1);
      }

      let packageJson = {};
      try {
        packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      } catch (_) {}

      console.log('\n📦 Building Webspresso production assets...\n');

      let cssBuilt = false;
      let jsBuilt = false;

      // 1. Build CSS (Tailwind)
      if (options.css !== false) {
        const hasCssScript = Boolean(packageJson.scripts && packageJson.scripts['build:css']);
        const hasInputCss = fs.existsSync(path.join(cwd, 'src', 'input.css'));

        if (hasCssScript) {
          try {
            console.log('🎨 Compiling Tailwind CSS...');
            execSync('npm run build:css', { stdio: 'inherit', cwd });
            cssBuilt = true;
          } catch (err) {
            console.error('❌ CSS build failed:', err.message);
          }
        } else if (hasInputCss) {
          console.log('ℹ️  src/input.css found but no "build:css" script. Run "npx webspresso add tailwind" to configure.');
        }
      }

      // 2. Build JS Bundle with manifest.json (esbuild)
      if (options.js !== false) {
        const hasClientEntry = fs.existsSync(path.join(cwd, 'src', 'client', 'main.js')) ||
          fs.existsSync(path.join(cwd, 'src', 'client', 'main.ts')) ||
          fs.existsSync(path.join(cwd, 'src', 'client', 'index.js'));
        const hasEsbuild = Boolean(
          (packageJson.devDependencies && packageJson.devDependencies.esbuild) ||
          (packageJson.dependencies && packageJson.dependencies.esbuild)
        );

        if (hasClientEntry || hasEsbuild) {
          try {
            console.log('⚡ Bundling client JavaScript with esbuild...');
            const result = await buildBundle({
              cwd,
              hash: options.hash !== false,
              minify: true,
              sourcemap: true,
              outdir: path.join(cwd, 'public', 'dist'),
            });
            jsBuilt = true;
            console.log(`✅ Client assets bundled and manifest created at: ${path.relative(cwd, result.manifestPath)}`);
          } catch (err) {
            // Fallback to npm run build:js if custom script exists
            if (packageJson.scripts && packageJson.scripts['build:js']) {
              try {
                execSync('npm run build:js', { stdio: 'inherit', cwd });
                jsBuilt = true;
              } catch (subErr) {
                console.error('❌ JS build failed:', subErr.message);
              }
            } else {
              console.error('❌ JS bundle build failed:', err.message);
            }
          }
        }
      }

      console.log('\n✨ Asset build complete!\n');
      if (cssBuilt) console.log('  ✓ CSS: public/css/style.css');
      if (jsBuilt) console.log('  ✓ JS: public/dist/ & manifest.json');
    });
}

module.exports = { registerCommand };

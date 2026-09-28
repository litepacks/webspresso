/**
 * Manifest Generator & esbuild Plugin for Webspresso Asset Management
 *
 * Generates production manifest.json from esbuild metafile for zero-config
 * cache busting and seamless integration with Webspresso AssetManager (fsy.asset, fsy.js, fsy.css).
 */

const fs = require('fs');
const path = require('path');

/**
 * Generates a Webspresso / Vite-compatible manifest object from an esbuild metafile
 *
 * @param {object} metafile - esbuild build result metafile
 * @param {object} [options={}]
 * @param {string} [options.outdir='public/dist']
 * @param {string} [options.publicDir='public']
 * @returns {Record<string, { file: string, src: string, bytes: number }>}
 */
function generateManifest(metafile, options = {}) {
  const publicDir = (options.publicDir || 'public').replace(/\\/g, '/').replace(/\/+$/, '');
  const manifest = {};

  if (!metafile || !metafile.outputs) {
    return manifest;
  }

  for (const [outPathRaw, meta] of Object.entries(metafile.outputs)) {
    // Skip sourcemap entries
    if (outPathRaw.endsWith('.map')) continue;

    const outPath = outPathRaw.replace(/\\/g, '/');
    let publicUrl = outPath;
    if (publicUrl.startsWith(publicDir + '/')) {
      publicUrl = publicUrl.slice(publicDir.length + 1);
    } else if (publicUrl.startsWith(publicDir)) {
      publicUrl = publicUrl.slice(publicDir.length);
    }
    if (publicUrl.startsWith('/')) {
      publicUrl = publicUrl.slice(1);
    }

    const entryPoint = meta.entryPoint ? meta.entryPoint.replace(/\\/g, '/') : null;
    const baseOutName = path.basename(publicUrl);

    const record = {
      file: publicUrl,
      src: entryPoint || baseOutName,
      bytes: meta.bytes || 0,
    };

    if (entryPoint) {
      // 1. Exact entry point (e.g. "src/client/main.js")
      manifest[entryPoint] = record;

      // 2. Base entry name (e.g. "main.js")
      const entryBase = path.basename(entryPoint);
      if (!manifest[entryBase]) {
        manifest[entryBase] = record;
      }

      // 3. Normalized without src/ (e.g. "client/main.js")
      const trimmedSrc = entryPoint.replace(/^src\//, '');
      if (!manifest[trimmedSrc]) {
        manifest[trimmedSrc] = record;
      }

      // 4. Normalized relative to client root (e.g. "pages/home.js")
      let clientRel = '';
      const srcClientIdx = entryPoint.indexOf('src/client/');
      if (srcClientIdx !== -1) {
        clientRel = entryPoint.slice(srcClientIdx + 'src/client/'.length);
      } else {
        const clientIdx = entryPoint.indexOf('client/');
        if (clientIdx !== -1) {
          clientRel = entryPoint.slice(clientIdx + 'client/'.length);
        } else {
          clientRel = entryPoint.replace(/^src\//, '');
        }
      }

      if (clientRel && !manifest[clientRel]) {
        manifest[clientRel] = record;
      }

      // 5. Conventional js/ prefix (e.g. "js/main.js" or "js/pages/home.js")
      const jsPrefixed = 'js/' + clientRel;
      if (!manifest[jsPrefixed]) {
        manifest[jsPrefixed] = record;
      }
      const jsBasePrefixed = 'js/' + entryBase;
      if (!manifest[jsBasePrefixed]) {
        manifest[jsBasePrefixed] = record;
      }

      // 6. Conventional css/ prefix for CSS inputs
      if (entryBase.endsWith('.css')) {
        const cssPrefixed = 'css/' + clientRel;
        if (!manifest[cssPrefixed]) {
          manifest[cssPrefixed] = record;
        }
        const cssBasePrefixed = 'css/' + entryBase;
        if (!manifest[cssBasePrefixed]) {
          manifest[cssBasePrefixed] = record;
        }
      }

      // 7. Key without file extension (e.g. "pages/home", "home")
      const nameWithoutExt = clientRel.replace(/\.[a-z0-9]+$/i, '');
      if (!manifest[nameWithoutExt]) {
        manifest[nameWithoutExt] = record;
      }
      const jsNameWithoutExt = 'js/' + nameWithoutExt;
      if (!manifest[jsNameWithoutExt]) {
        manifest[jsNameWithoutExt] = record;
      }
    } else {
      manifest[baseOutName] = record;
    }
  }

  return manifest;
}

/**
 * Creates an esbuild plugin that writes out a production manifest.json upon build completion
 *
 * @param {object} [options={}]
 * @param {string} [options.manifestPath]
 * @param {string} [options.outdir='public/dist']
 * @param {string} [options.publicDir='public']
 * @param {object} [options.logger=console]
 * @returns {object} esbuild plugin
 */
function createManifestPlugin(options = {}) {
  const manifestPath = options.manifestPath || path.join(options.outdir || 'public/dist', 'manifest.json');
  const logger = options.logger !== undefined ? options.logger : console;

  return {
    name: 'webspresso-manifest',
    setup(build) {
      build.onEnd((result) => {
        if (!result.errors || result.errors.length === 0) {
          if (result.metafile) {
            const manifest = generateManifest(result.metafile, options);
            const fullManifestPath = path.resolve(manifestPath);
            const dir = path.dirname(fullManifestPath);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(fullManifestPath, JSON.stringify(manifest, null, 2) + '\n');
            if (logger && logger.log) {
              logger.log(`📦 [Webspresso] Generated asset manifest: ${manifestPath}`);
            }
          }
        }
      });
    },
  };
}

module.exports = {
  generateManifest,
  createManifestPlugin,
};

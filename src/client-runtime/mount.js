/**
 * Mount routes for vendored Alpine / Swup client runtime assets
 */

const path = require('path');
const fs = require('fs');
const { createCompatApp } = require('../http/compat-app');

const CLIENT_RUNTIME_BASE = '/__webspresso/client-runtime';

function pkgFileFromMain(pkg, ...segments) {
  const entry = require.resolve(pkg);
  return path.join(path.dirname(entry), ...segments);
}

/**
 * @param {import('../http/compat-app').createCompatApp} app
 * @param {{ alpine: boolean, swup: boolean }} flags
 */
function mountClientRuntime(app, flags) {
  if (!flags || (!flags.alpine && !flags.swup)) return;

  const router = createCompatApp();

  function sendFile(res, filePath) {
    const body = fs.readFileSync(filePath);
    res.type('application/javascript');
    res.send(body);
  }

  if (flags.alpine) {
    router.get('/alpine.min.js', (req, res) => {
      sendFile(res, pkgFileFromMain('alpinejs', 'cdn.min.js'));
    });
  }

  if (flags.swup) {
    router.get('/swup.umd.js', (req, res) => {
      sendFile(res, pkgFileFromMain('swup', 'Swup.umd.js'));
    });
    router.get('/swup-head-plugin.umd.js', (req, res) => {
      sendFile(res, pkgFileFromMain('@swup/head-plugin', 'index.umd.js'));
    });
    router.get('/swup-scripts-plugin.umd.js', (req, res) => {
      sendFile(res, pkgFileFromMain('@swup/scripts-plugin', 'index.umd.js'));
    });
    const runtimeDir = __dirname;
    if (flags.alpine) {
      router.get('/bootstrap-alpine-swup.js', (req, res) => {
        sendFile(res, path.join(runtimeDir, 'bootstrap-alpine-swup.js'));
      });
    } else {
      router.get('/bootstrap-swup.js', (req, res) => {
        sendFile(res, path.join(runtimeDir, 'bootstrap-swup.js'));
      });
    }
  }

  app.use(CLIENT_RUNTIME_BASE, router);
}

module.exports = {
  mountClientRuntime,
  CLIENT_RUNTIME_BASE,
};

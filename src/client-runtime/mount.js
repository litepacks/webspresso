/**
 * Mount Express routes that serve vendored Alpine / Swup UMD builds from node_modules
 * and framework bootstrap scripts from src/client-runtime/.
 */

const path = require('path');
const express = require('express');

const CLIENT_RUNTIME_BASE = '/__webspresso/client-runtime';

/** Resolve a file next to the package's resolved main entry (works with package "exports"). */
function pkgFileFromMain(pkg, ...segments) {
  const entry = require.resolve(pkg);
  return path.join(path.dirname(entry), ...segments);
}

/**
 * @param {import('express').Express} app
 * @param {{ alpine: boolean, swup: boolean }} flags
 */
function mountClientRuntime(app, flags) {
  if (!flags || (!flags.alpine && !flags.swup)) return;

  const router = express.Router();

  function send(res, filePath) {
    res.type('application/javascript');
    res.sendFile(filePath);
  }

  if (flags.alpine) {
    router.get('/alpine.min.js', (req, res) => {
      send(res, pkgFileFromMain('alpinejs', 'cdn.min.js'));
    });
  }

  if (flags.swup) {
    router.get('/swup.umd.js', (req, res) => {
      send(res, pkgFileFromMain('swup', 'Swup.umd.js'));
    });
    router.get('/swup-head-plugin.umd.js', (req, res) => {
      send(res, pkgFileFromMain('@swup/head-plugin', 'index.umd.js'));
    });
    router.get('/swup-scripts-plugin.umd.js', (req, res) => {
      send(res, pkgFileFromMain('@swup/scripts-plugin', 'index.umd.js'));
    });
    const runtimeDir = __dirname;
    if (flags.alpine) {
      router.get('/bootstrap-alpine-swup.js', (req, res) => {
        send(res, path.join(runtimeDir, 'bootstrap-alpine-swup.js'));
      });
    } else {
      router.get('/bootstrap-swup.js', (req, res) => {
        send(res, path.join(runtimeDir, 'bootstrap-swup.js'));
      });
    }
  }

  app.use(CLIENT_RUNTIME_BASE, router);
}

module.exports = {
  mountClientRuntime,
  CLIENT_RUNTIME_BASE,
};

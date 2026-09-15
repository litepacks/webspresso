'use strict';

/**
 * Webspresso Module Discovery Utilities
 * Auto-discovers services and middlewares within feature module directories
 * @module src/modules/module-discovery
 */

const fs = require('fs');
const path = require('path');
const { scanDirSafely, isPrivateOrIgnored } = require('../discovery/file-route-parser');

/**
 * Converts a file path to camelCase or dot-separated identifier
 * @param {string} str
 * @returns {string}
 */
function toCamelCase(str) {
  return str.replace(/[-_](\w)/g, (_, c) => c.toUpperCase());
}

/**
 * Discovers services, middlewares, and configuration for a module directory
 * @param {string} modulePath - Absolute path to module folder (e.g. /app/modules/auth)
 * @param {string} moduleName - Name of the module (e.g. 'auth')
 * @returns {{ services: Record<string, any>, middlewares: Record<string, Function>, config: Object|null }}
 */
function discoverModuleDetails(modulePath, moduleName) {
  const discovered = {
    services: {},
    middlewares: {},
    config: null,
  };

  if (!fs.existsSync(modulePath)) return discovered;

  // 1. Check for module configuration file
  const configCandidates = [
    path.join(modulePath, `${moduleName}.module.js`),
    path.join(modulePath, 'module.js'),
    path.join(modulePath, 'index.js'),
  ];
  for (const cf of configCandidates) {
    if (fs.existsSync(cf)) {
      try {
        const loaded = require(cf);
        const evaluated = typeof loaded === 'function' ? loaded() : loaded;
        discovered.config = evaluated && evaluated.moduleConfig ? evaluated.moduleConfig : evaluated;
      } catch (err) {
        console.warn(`[webspresso] Error loading module config ${cf}:`, err.message);
      }
      break;
    }
  }

  // 2. Discover Services in modules/{name}/services/
  const servicesDir = path.join(modulePath, 'services');
  if (fs.existsSync(servicesDir)) {
    const serviceFiles = scanDirSafely(servicesDir);
    for (const { absolutePath, relativePath } of serviceFiles) {
      if (!relativePath.endsWith('.js')) continue;
      const baseName = relativePath.slice(0, -3).split(path.sep).join('.');
      const qualifiedName = `${moduleName}.${baseName}`;
      try {
        const serviceModule = require(absolutePath);
        const serviceDef = serviceModule.default || serviceModule;
        discovered.services[qualifiedName] = serviceDef;

        // Also add camelCase alias if hyphenated
        const camelAlias = `${moduleName}.${toCamelCase(baseName)}`;
        if (camelAlias !== qualifiedName) {
          discovered.services[camelAlias] = serviceDef;
        }
      } catch (err) {
        console.warn(`[webspresso] Error loading module service ${absolutePath}:`, err.message);
      }
    }
  }

  // 3. Discover Middlewares in modules/{name}/middleware/ or middlewares/
  const mwDirs = [path.join(modulePath, 'middleware'), path.join(modulePath, 'middlewares')];
  for (const mwDir of mwDirs) {
    if (fs.existsSync(mwDir)) {
      const mwFiles = scanDirSafely(mwDir);
      for (const { absolutePath, relativePath } of mwFiles) {
        if (!relativePath.endsWith('.js')) continue;
        const rawName = path.basename(relativePath, '.js');
        try {
          const mwModule = require(absolutePath);
          const mwFn = mwModule.default || mwModule;
          if (typeof mwFn === 'function') {
            discovered.middlewares[rawName] = mwFn;
            discovered.middlewares[toCamelCase(rawName)] = mwFn;
          }
        } catch (err) {
          console.warn(`[webspresso] Error loading module middleware ${absolutePath}:`, err.message);
        }
      }
    }
  }

  // Merge explicitly defined middlewares from module config
  if (discovered.config?.middlewares && typeof discovered.config.middlewares === 'object') {
    Object.assign(discovered.middlewares, discovered.config.middlewares);
  }

  // Merge explicitly defined services from module config
  if (discovered.config?.services && typeof discovered.config.services === 'object') {
    Object.assign(discovered.services, discovered.config.services);
  }

  return discovered;
}

module.exports = {
  discoverModuleDetails,
};

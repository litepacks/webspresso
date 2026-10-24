'use strict';

/**
 * Webspresso TypeGen Engine
 * Automatic TypeScript & IDE auto-complete generator for ORM models, business services, and routes
 * @module src/dev/typegen
 */

const fs = require('fs');
const path = require('path');
const { getAllModels } = require('../../core/orm/model');
const { hasServiceRegistry, getServiceRegistry } = require('../../core/context');
const { scanRoutes } = require('../../src/discovery/scan-routes');
const { compileRouteTable } = require('../../src/routing/route-table');
const { z } = require('../../core/validation');

/**
 * Converts a Zod type schema to a TypeScript type string
 * @param {import('zod').ZodTypeAny} zType
 * @param {number} [indent=0]
 * @returns {string}
 */
function zodToTsType(zType, indent = 0) {
  if (!zType || !zType._def) return 'unknown';
  const typeName = zType._def.typeName;
  const spaces = '  '.repeat(indent);
  const nextSpaces = '  '.repeat(indent + 1);

  switch (typeName) {
    case 'ZodString':
      return 'string';
    case 'ZodNumber':
      return 'number';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodDate':
      return 'Date';
    case 'ZodBigInt':
      return 'bigint';
    case 'ZodNull':
      return 'null';
    case 'ZodUndefined':
      return 'undefined';
    case 'ZodVoid':
      return 'void';
    case 'ZodAny':
      return 'any';
    case 'ZodUnknown':
      return 'unknown';
    case 'ZodNever':
      return 'never';
    case 'ZodLiteral':
      return typeof zType._def.value === 'string'
        ? `'${zType._def.value}'`
        : String(zType._def.value);
    case 'ZodEnum':
      return (zType._def.values || []).map((v) => `'${v}'`).join(' | ') || 'string';
    case 'ZodNativeEnum':
      return 'number | string';
    case 'ZodArray':
      return `Array<${zodToTsType(zType._def.type, indent)}>`;
    case 'ZodOptional':
      return `${zodToTsType(zType._def.innerType, indent)} | undefined`;
    case 'ZodNullable':
      return `${zodToTsType(zType._def.innerType, indent)} | null`;
    case 'ZodDefault':
      return zodToTsType(zType._def.innerType, indent);
    case 'ZodEffects':
      return zodToTsType(zType._def.schema, indent);
    case 'ZodUnion':
      return (zType._def.options || []).map((opt) => zodToTsType(opt, indent)).join(' | ') || 'unknown';
    case 'ZodObject': {
      const shape = zType.shape;
      if (!shape || Object.keys(shape).length === 0) return 'Record<string, unknown>';
      const entries = Object.entries(shape).map(([k, v]) => {
        const isOpt = v?._def?.typeName === 'ZodOptional';
        const innerType = isOpt ? zodToTsType(v._def.innerType, indent + 1) : zodToTsType(v, indent + 1);
        return `${nextSpaces}${k}${isOpt ? '?' : ''}: ${innerType};`;
      });
      return `{\n${entries.join('\n')}\n${spaces}}`;
    }
    case 'ZodRecord':
      return `Record<string, ${zodToTsType(zType._def.valueType, indent)}>`;
    default:
      return 'unknown';
  }
}

/**
 * Collects ORM model definitions from memory and filesystem
 * @param {string} [modelsDir]
 * @returns {Array<Object>}
 */
function collectModelMetadata(modelsDir) {
  // If modelsDir exists, load JS files into registry if not already loaded
  if (modelsDir && fs.existsSync(modelsDir)) {
    try {
      const files = fs.readdirSync(modelsDir);
      for (const file of files) {
        if (file.endsWith('.js') && !file.startsWith('_') && !file.startsWith('.')) {
          const filePath = path.join(modelsDir, file);
          try {
            require(path.resolve(filePath));
          } catch {
            // ignore if requires database connection
          }
        }
      }
    } catch {
      // directory read failure
    }
  }

  const result = [];
  try {
    const registered = getAllModels();
    for (const [name, model] of registered.entries()) {
      const columns = [];
      if (model.schema && model.schema.shape) {
        for (const [colName, colZod] of Object.entries(model.schema.shape)) {
          const isOpt = colZod?._def?.typeName === 'ZodOptional';
          const innerZod = isOpt ? colZod._def.innerType : colZod;
          columns.push({
            name: colName,
            isOptional: isOpt,
            tsType: zodToTsType(innerZod, 1),
          });
        }
      }

      // Check if primaryKey exists in columns, otherwise add it
      const pkName = model.primaryKey || 'id';
      if (!columns.some((c) => c.name === pkName)) {
        columns.unshift({
          name: pkName,
          isOptional: false,
          tsType: 'number | string',
        });
      }

      // Timestamps scope
      const hasTimestamps = Boolean(model.scopes?.timestamps || model.timestamps);
      if (hasTimestamps) {
        if (!columns.some((c) => c.name === 'created_at')) {
          columns.push({ name: 'created_at', isOptional: true, tsType: 'Date' });
        }
        if (!columns.some((c) => c.name === 'updated_at')) {
          columns.push({ name: 'updated_at', isOptional: true, tsType: 'Date' });
        }
      }

      // Soft delete scope
      const hasSoftDelete = Boolean(
        model.scopes?.softDelete || model.scopes?.notDeleted || model.softDelete || model.paranoid
      );
      if (hasSoftDelete) {
        if (!columns.some((c) => c.name === 'deleted_at')) {
          columns.push({ name: 'deleted_at', isOptional: true, tsType: 'Date | null' });
        }
      }

      result.push({
        name,
        table: model.table || name.toLowerCase(),
        primaryKey: pkName,
        columns,
        relations: model.relations || {},
      });
    }
  } catch {
    // registry read failure
  }

  return result;
}

/**
 * Scans services directory recursively
 * @param {string} dir
 * @param {string} [baseDir]
 * @returns {Array<Object>}
 */
function scanServicesDir(dir, baseDir = dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const services = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      services.push(...scanServicesDir(fullPath, baseDir));
    } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.startsWith('_') && !entry.name.startsWith('.')) {
      const relPath = path.relative(baseDir, fullPath);
      const dotName = relPath.replace(/\.js$/, '').split(path.sep).join('.');
      
      let inputTsType = 'unknown';
      let hasSchema = false;

      try {
        const mod = require(path.resolve(fullPath));
        const def = mod && mod.default ? mod.default : mod;
        let schema = def && def.schema;
        if (typeof schema === 'function') {
          try {
            schema = schema({ z });
          } catch {
            schema = null;
          }
        }

        if (schema && typeof schema.parse !== 'function' && typeof schema === 'object') {
          if (schema.body && typeof schema.body.parse === 'function') {
            schema = schema.body;
          } else if (Object.values(schema).some((v) => v && typeof v.parse === 'function')) {
            schema = z.object(schema);
          }
        }

        if (schema && typeof schema.parse === 'function') {
          hasSchema = true;
          inputTsType = zodToTsType(schema, 2);
        }
      } catch {
        // Module failed to load
      }

      services.push({
        name: dotName,
        filePath: fullPath,
        inputTsType,
        hasSchema,
      });
    }
  }

  return services;
}

/**
 * Collects services from directory and active ServiceRegistry
 * @param {string} [servicesDir]
 * @returns {Array<Object>}
 */
function collectServiceMetadata(servicesDir) {
  const map = new Map();

  // 1. Filesystem scan
  if (servicesDir && fs.existsSync(servicesDir)) {
    const fileServices = scanServicesDir(servicesDir);
    for (const s of fileServices) {
      map.set(s.name, s);
    }
  }

  // 2. Active runtime registry
  try {
    if (hasServiceRegistry()) {
      const registry = getServiceRegistry();
      if (registry && registry.services) {
        for (const [name, def] of registry.services.entries()) {
          if (!map.has(name)) {
            let inputTsType = 'unknown';
            let schema = def?.schema;
            if (typeof schema === 'function') {
              try {
                schema = schema({ z });
              } catch {
                schema = null;
              }
            }
            if (schema && typeof schema.parse === 'function') {
              inputTsType = zodToTsType(schema, 2);
            }
            map.set(name, {
              name,
              filePath: '',
              inputTsType,
              hasSchema: Boolean(schema),
            });
          }
        }
      }
    }
  } catch {
    // Registry not active
  }

  return Array.from(map.values());
}

/**
 * Collects discovered routes from pages directory
 * @param {string} rootDir
 * @param {string} pagesRelDir
 * @returns {Array<Object>}
 */
function collectRouteMetadata(rootDir, pagesRelDir) {
  const pagesDir = path.resolve(rootDir, pagesRelDir);
  if (!fs.existsSync(pagesDir)) return [];

  try {
    const apiRelDir = path.join(pagesRelDir, 'api');
    const apiDir = path.resolve(rootDir, apiRelDir);
    const descriptors = scanRoutes({
      rootDir,
      pages: { dir: pagesRelDir },
      api: fs.existsSync(apiDir) ? { dir: apiRelDir } : false,
    });
    const table = compileRouteTable(descriptors, { isDev: true });
    return table.list();
  } catch {
    return [];
  }
}

/**
 * Generates the complete TypeScript declaration content
 * @param {Object} data
 * @param {Array<Object>} data.models
 * @param {Array<Object>} data.services
 * @param {Array<Object>} data.routes
 * @returns {string}
 */
function generateDeclarationCode({ models = [], services = [], routes = [] }) {
  const timestamp = new Date().toISOString();

  let code = `/**
 * Webspresso Application Type Definitions
 * Auto-generated by "npx webspresso typegen" on ${timestamp}
 * DO NOT EDIT DIRECTLY. Regenerate using: npx webspresso typegen
 */

import type { Repository, ScopeContext } from 'webspresso';

/* ============================================================================
 * 1. ORM Model Entity Interfaces
 * ========================================================================= */
`;

  if (models.length === 0) {
    code += `\n// No ORM models detected in models/ directory.\n`;
  } else {
    for (const m of models) {
      code += `\nexport interface ${m.name}Model {\n`;
      for (const col of m.columns) {
        code += `  ${col.name}${col.isOptional ? '?' : ''}: ${col.tsType};\n`;
      }
      code += `}\n`;
    }
  }

  code += `\n/* ============================================================================
 * 2. Business Services Mapping
 * ========================================================================= */\n`;

  code += `\nexport interface WebspressoServicesMap {\n`;
  if (services.length === 0) {
    code += `  [key: string]: { input: any; output: any };\n`;
  } else {
    for (const s of services) {
      code += `  '${s.name}': {\n    input: ${s.inputTsType};\n    output: unknown;\n  };\n`;
    }
  }
  code += `}\n`;

  code += `\n/* ============================================================================
 * 3. Application Routes
 * ========================================================================= */\n`;

  if (routes.length === 0) {
    code += `\nexport type AppRoute = string;\nexport type AppRoutePath = string;\n`;
  } else {
    const routeKeys = routes.map((r) => `'${(r.method || 'GET').toUpperCase()} ${r.path || r.pattern}'`);
    const pathKeys = Array.from(new Set(routes.map((r) => `'${r.path || r.pattern}'`)));
    code += `\nexport type AppRoute = \n  | ${routeKeys.join('\n  | ')};\n`;
    code += `\nexport type AppRoutePath = \n  | ${pathKeys.join('\n  | ')};\n`;
  }

  code += `\n/* ============================================================================
 * 4. Webspresso Framework Module Augmentation
 * ========================================================================= */\n\n`;

  code += `declare module 'webspresso' {\n`;

  // Augment WebspressoModels
  code += `  interface WebspressoModels {\n`;
  if (models.length === 0) {
    code += `    [key: string]: Record<string, any>;\n`;
  } else {
    for (const m of models) {
      code += `    ${m.name}: ${m.name}Model;\n`;
    }
  }
  code += `  }\n\n`;

  // Augment WebspressoServices
  code += `  interface WebspressoServices extends WebspressoServicesMap {}\n\n`;

  // Augment DatabaseInstance getRepository
  code += `  interface DatabaseInstance {\n`;
  code += `    getRepository<K extends keyof WebspressoModels>(modelName: K, scopeContext?: ScopeContext): Repository<WebspressoModels[K]>;\n`;
  code += `    getRepository<T = Record<string, any>>(modelName: string, scopeContext?: ScopeContext): Repository<T>;\n`;
  code += `  }\n\n`;

  // Augment TransactionContext getRepository
  code += `  interface TransactionContext {\n`;
  code += `    getRepository<K extends keyof WebspressoModels>(modelName: K, scopeContext?: ScopeContext): Repository<WebspressoModels[K]>;\n`;
  code += `    getRepository<T = Record<string, any>>(modelName: string, scopeContext?: ScopeContext): Repository<T>;\n`;
  code += `  }\n\n`;

  // Augment ServiceRegistry
  code += `  interface ServiceRegistry {\n`;
  code += `    call<K extends keyof WebspressoServicesMap>(name: K, input?: WebspressoServicesMap[K]['input'], ctx?: unknown, options?: unknown): Promise<WebspressoServicesMap[K]['output']>;\n`;
  code += `    call<T = unknown>(name: string, input?: unknown, ctx?: unknown, options?: unknown): Promise<T>;\n`;
  code += `  }\n`;

  code += `}\n\n`;

  code += `export type AppModelName = keyof import('webspresso').WebspressoModels;\n`;
  code += `export type AppServiceName = keyof WebspressoServicesMap;\n`;

  return code;
}

/**
 * Main TypeGen Runner
 * Scans models, services, and routes, and writes TypeScript declarations
 * @param {Object} [options]
 * @param {string} [options.rootDir] - Root directory of the project
 * @param {string} [options.modelsDir] - Models directory (default: 'models')
 * @param {string} [options.servicesDir] - Services directory (default: 'services')
 * @param {string} [options.pagesDir] - Pages directory (default: 'pages')
 * @param {string} [options.outDir] - Output directory (default: '.webspresso')
 * @param {string} [options.outFile] - Custom output file path
 * @param {boolean} [options.createEnvFile=true] - Create webspresso-env.d.ts at project root
 * @param {boolean} [options.write=true] - Write declaration files to disk
 * @param {boolean} [options.silent=false] - Suppress console output
 * @returns {{ code: string, modelsCount: number, servicesCount: number, routesCount: number, outFile: string, envFile: string|null }}
 */
function generateTypes(options = {}) {
  const rootDir = path.resolve(options.rootDir || options.cwd || process.cwd());
  const modelsRel = options.modelsDir || (fs.existsSync(path.join(rootDir, 'src/models')) ? 'src/models' : 'models');
  const servicesRel = options.servicesDir || (fs.existsSync(path.join(rootDir, 'src/services')) ? 'src/services' : 'services');
  const pagesRel = options.pagesDir || (fs.existsSync(path.join(rootDir, 'src/pages')) ? 'src/pages' : 'pages');

  const modelsDir = path.resolve(rootDir, modelsRel);
  const servicesDir = path.resolve(rootDir, servicesRel);

  const models = collectModelMetadata(modelsDir);
  const services = collectServiceMetadata(servicesDir);
  const routes = collectRouteMetadata(rootDir, pagesRel);

  const code = generateDeclarationCode({ models, services, routes });

  const outDir = path.resolve(rootDir, options.outDir || '.webspresso');
  const outFile = options.outFile ? path.resolve(rootDir, options.outFile) : path.join(outDir, 'types.d.ts');
  const envFile = options.createEnvFile !== false ? path.join(rootDir, 'webspresso-env.d.ts') : null;

  if (options.write !== false) {
    // Ensure destination directory exists
    const targetDir = path.dirname(outFile);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    fs.writeFileSync(outFile, code, 'utf8');

    // Create root environment declaration helper if enabled
    if (envFile) {
      const relToOut = path.relative(rootDir, outFile).replace(/\\/g, '/');
      const envContent = `/// <reference path="./${relToOut}" />\n`;
      fs.writeFileSync(envFile, envContent, 'utf8');
    }

    if (!options.silent) {
      console.log(`[typegen] ✓ Generated types for ${models.length} models, ${services.length} services, and ${routes.length} routes.`);
      console.log(`[typegen] → ${path.relative(rootDir, outFile)}`);
    }
  }

  return {
    code,
    modelsCount: models.length,
    servicesCount: services.length,
    routesCount: routes.length,
    outFile,
    envFile,
  };
}

module.exports = {
  zodToTsType,
  collectModelMetadata,
  collectServiceMetadata,
  collectRouteMetadata,
  generateDeclarationCode,
  generateTypes,
};

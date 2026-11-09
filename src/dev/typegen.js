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
const {
  collectApiRouteContracts: collectApiRouteContractsRaw,
  generateApiDeclarationCode,
  checkTemplateFormContracts: checkTemplateFormContractsRaw,
} = require('./api-typegen');

/**
 * Infer the output TypeScript type of a Zod `.transform(fn)` effect when possible.
 *
 * @param {Function} transformFn
 * @param {import('zod').ZodTypeAny} innerSchema
 * @param {number} indent
 * @param {'output'|'input'|'wire'} mode
 * @returns {string}
 */
function inferZodTransformOutputType(transformFn, innerSchema, indent, mode) {
  if (typeof transformFn !== 'function') {
    return zodToTsType(innerSchema, indent, mode);
  }
  const fnSrc = Function.prototype.toString.call(transformFn).trim();
  if (/^(?:function\s*\([^)]*\)\s*\{\s*return\s+)?Number\s*\(/.test(fnSrc) || /=>\s*Number\s*\(/.test(fnSrc) || /=>\s*parseInt\s*\(/.test(fnSrc) || /=>\s*parseFloat\s*\(/.test(fnSrc) || /=>\s*\+\s*[a-zA-Z_$]/.test(fnSrc)) {
    return 'number';
  }
  if (/=>\s*String\s*\(/.test(fnSrc) || /\.trim\(\)\s*$/.test(fnSrc) || /\.toLowerCase\(\)\s*$/.test(fnSrc) || /\.toUpperCase\(\)\s*$/.test(fnSrc)) {
    return 'string';
  }
  if (/=>\s*Boolean\s*\(/.test(fnSrc) || /=>\s*!!/.test(fnSrc)) {
    return 'boolean';
  }
  if (/\.split\s*\(/.test(fnSrc)) {
    return 'Array<string>';
  }
  if (/=>\s*new\s+Date\s*\(/.test(fnSrc)) {
    return mode === 'wire' ? 'string' : 'Date';
  }
  // Try executing transform on a safe dummy sample if innerSchema is primitive
  const innerType = innerSchema && innerSchema._def && innerSchema._def.typeName;
  try {
    let sample;
    if (innerType === 'ZodString') sample = '1';
    else if (innerType === 'ZodNumber') sample = 1;
    else if (innerType === 'ZodBoolean') sample = true;
    if (sample !== undefined) {
      const out = transformFn(sample, { addIssue() {}, path: [] });
      if (typeof out === 'number') return 'number';
      if (typeof out === 'string') return 'string';
      if (typeof out === 'boolean') return 'boolean';
      if (out instanceof Date) return mode === 'wire' ? 'string' : 'Date';
      if (Array.isArray(out)) return 'Array<unknown>';
    }
  } catch {
    // Ignore sample execution errors
  }
  return zodToTsType(innerSchema, indent, mode);
}

/**
 * Checks whether a Zod field is optional in the given mode ('input' vs 'output' vs 'wire').
 * Notice: `ZodDefault` is optional in 'input' mode (client may omit it),
 * but required in 'output' mode (server receives the defaulted value).
 *
 * @param {import('zod').ZodTypeAny} zField
 * @param {'output'|'input'|'wire'} mode
 * @returns {boolean}
 */
function isZodFieldOptional(zField, mode = 'output') {
  if (!zField || !zField._def) return false;
  const t = zField._def.typeName;
  if (t === 'ZodOptional') return true;
  if (t === 'ZodDefault') {
    return mode === 'input';
  }
  if (t === 'ZodEffects' && zField._def.schema) {
    return isZodFieldOptional(zField._def.schema, mode);
  }
  return false;
}

/**
 * Unwraps outer `ZodOptional` / `ZodDefault` for property type emission inside `ZodObject`.
 */
function unwrapOptionalOrDefault(zField, mode = 'output') {
  if (!zField || !zField._def) return zField;
  const t = zField._def.typeName;
  if (t === 'ZodOptional') {
    return zField._def.innerType;
  }
  if (t === 'ZodDefault' && mode === 'input') {
    return zField._def.innerType;
  }
  return zField;
}

/**
 * Converts a Zod type schema to a TypeScript type string
 * @param {import('zod').ZodTypeAny} zType
 * @param {number} [indent=0]
 * @param {'output'|'input'|'wire'} [mode='output'] - 'input' (client payload), 'output' (server parsed), or 'wire' (JSON wire format)
 * @returns {string}
 */
function zodToTsType(zType, indent = 0, mode = 'output') {
  if (!zType || !zType._def) return 'unknown';
  const typeName = zType._def.typeName;
  const spaces = '  '.repeat(indent);
  const nextSpaces = '  '.repeat(indent + 1);

  // Support custom zdb.file() metadata
  if (zType._zdbMeta && zType._zdbMeta.columnType === 'file') {
    return mode === 'input' ? 'File | Blob | string' : 'string';
  }

  switch (typeName) {
    case 'ZodString':
      return 'string';
    case 'ZodNumber':
      if (mode === 'input' && zType._def.coerce) {
        return 'number | string';
      }
      return 'number';
    case 'ZodBoolean':
      if (mode === 'input' && zType._def.coerce) {
        return 'boolean | string';
      }
      return 'boolean';
    case 'ZodDate':
      if (mode === 'wire') return 'string';
      if (mode === 'input') return 'Date | string';
      return 'Date';
    case 'ZodBigInt':
      return mode === 'wire' ? 'string' : 'bigint';
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
      return `Array<${zodToTsType(zType._def.type, indent, mode)}>`;
    case 'ZodOptional':
      return `${zodToTsType(zType._def.innerType, indent, mode)} | undefined`;
    case 'ZodNullable':
      return `${zodToTsType(zType._def.innerType, indent, mode)} | null`;
    case 'ZodDefault':
      return zodToTsType(zType._def.innerType, indent, mode);
    case 'ZodEffects': {
      if (mode === 'input') {
        if (zType._def.effect && zType._def.effect.type === 'preprocess') {
          return `${zodToTsType(zType._def.schema, indent, mode)} | string`;
        }
        return zodToTsType(zType._def.schema, indent, mode);
      }
      if (zType._def.effect && zType._def.effect.type === 'transform') {
        return inferZodTransformOutputType(
          zType._def.effect.transform,
          zType._def.schema,
          indent,
          mode
        );
      }
      return zodToTsType(zType._def.schema, indent, mode);
    }
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion':
      return (zType._def.options || []).map((opt) => zodToTsType(opt, indent, mode)).join(' | ') || 'unknown';
    case 'ZodObject': {
      const shape = typeof zType.shape === 'function' ? zType.shape() : zType.shape;
      if (!shape || Object.keys(shape).length === 0) return 'Record<string, unknown>';
      const entries = [];
      for (const [k, v] of Object.entries(shape)) {
        if (mode === 'wire' && v && v._def && (v._def.typeName === 'ZodUndefined' || v._def.typeName === 'ZodVoid')) {
          continue;
        }
        const isOpt = isZodFieldOptional(v, mode);
        const unwrapped = unwrapOptionalOrDefault(v, mode);
        const innerType = zodToTsType(unwrapped, indent + 1, mode);
        const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : `'${k}'`;
        entries.push(`${nextSpaces}${safeKey}${isOpt ? '?' : ''}: ${innerType};`);
      }
      if (entries.length === 0) return 'Record<string, never>';
      return `{\n${entries.join('\n')}\n${spaces}}`;
    }
    case 'ZodRecord':
      return `Record<string, ${zodToTsType(zType._def.valueType, indent, mode)}>`;
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
  const apiContracts = collectApiRouteContracts(rootDir, { pagesDir: pagesRel });

  const code = generateDeclarationCode({ models, services, routes });
  const apiCode = generateApiDeclarationCode(apiContracts);

  const outDir = path.resolve(rootDir, options.outDir || '.webspresso');
  const outFile = options.outFile ? path.resolve(rootDir, options.outFile) : path.join(outDir, 'types.d.ts');
  const apiOutFile = options.apiOutFile ? path.resolve(rootDir, options.apiOutFile) : path.join(path.dirname(outFile), 'api.d.ts');
  const envFile = options.createEnvFile !== false ? path.join(rootDir, 'webspresso-env.d.ts') : null;

  if (options.write !== false) {
    // Ensure destination directory exists
    const targetDir = path.dirname(outFile);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    fs.writeFileSync(outFile, code, 'utf8');
    fs.writeFileSync(apiOutFile, apiCode, 'utf8');

    // Create root environment declaration helper if enabled
    if (envFile) {
      const relToOut = path.relative(rootDir, outFile).replace(/\\/g, '/');
      const relToApi = path.relative(rootDir, apiOutFile).replace(/\\/g, '/');
      const envContent = `/// <reference path="./${relToOut}" />\n/// <reference path="./${relToApi}" />\n`;
      fs.writeFileSync(envFile, envContent, 'utf8');
    }

    if (!options.silent) {
      console.log(`[typegen] ✓ Generated types for ${models.length} models, ${services.length} services, and ${routes.length} routes.`);
      console.log(`[typegen] → ${path.relative(rootDir, outFile)}`);
      console.log(`[typegen] → ${path.relative(rootDir, apiOutFile)}`);
    }
  }

  return {
    code,
    apiCode,
    modelsCount: models.length,
    servicesCount: services.length,
    routesCount: routes.length,
    apiContractsCount: apiContracts.length,
    apiContracts,
    outFile,
    apiOutFile,
    envFile,
  };
}

function collectApiRouteContracts(rootDir, options = {}) {
  return collectApiRouteContractsRaw(rootDir, {
    ...options,
    zodToTsType,
  });
}

function checkTemplateFormContracts(rootDir, options = {}) {
  return checkTemplateFormContractsRaw(rootDir, {
    ...options,
    zodToTsType,
  });
}

module.exports = {
  zodToTsType,
  collectModelMetadata,
  collectServiceMetadata,
  collectRouteMetadata,
  collectApiRouteContracts,
  generateDeclarationCode,
  generateApiDeclarationCode,
  checkTemplateFormContracts,
  generateTypes,
};

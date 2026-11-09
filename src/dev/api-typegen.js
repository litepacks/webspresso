'use strict';

/**
 * Webspresso API Type Manifest & Static HTML Form Contract Checker
 *
 * Derives end-to-end TypeScript definitions (`.webspresso/api.d.ts`) from existing
 * `defineApi({ schema, response, handler })` route files without duplicating DTOs
 * or importing server handlers into browser bundles.
 *
 * Also provides static HTML/Nunjucks `<form>` field verification against route schemas
 * for `webspresso doctor` and `webspresso build`.
 *
 * @module src/dev/api-typegen
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { scanRoutes } = require('../discovery/scan-routes');
const {
  parseFileRoute,
  isClientBrowserFile,
  isPrivateOrIgnored,
} = require('../discovery/file-route-parser');
const { z, zdb } = require('../../core/validation');

let tsCompiler = null;
try {
  tsCompiler = require('typescript');
} catch {
  tsCompiler = null;
}

/**
 * Recursively scan a directory for API route files (including `.js` and `.ts`),
 * excluding `.client.*` and `.d.ts` browser files.
 *
 * @param {string} dirPath
 * @param {string} [baseDir=dirPath]
 * @returns {Array<{ absolutePath: string, relativePath: string }>}
 */
function scanApiFilesIncludingTs(dirPath, baseDir = dirPath) {
  const results = [];
  if (!dirPath || !fs.existsSync(dirPath)) return results;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const name = entry.name;
      if (isPrivateOrIgnored(name) || isClientBrowserFile(name)) continue;

      const fullPath = path.join(dirPath, name);
      const relPath = path.relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        results.push(...scanApiFilesIncludingTs(fullPath, baseDir));
      } else if (entry.isFile()) {
        const ext = path.extname(name);
        if (ext === '.js' || ext === '.ts') {
          results.push({ absolutePath: fullPath, relativePath: relPath });
        }
      }
    }
  } catch {
    // Ignore unreadable directories
  }
  return results;
}

/**
 * Load an API route module from `.js` or `.ts` without leaving stale cache entries.
 *
 * @param {string} filePath
 * @returns {{ mod: any, source: string }}
 */
function loadApiRouteModule(filePath) {
  const fullPath = path.resolve(filePath);
  const source = fs.readFileSync(fullPath, 'utf8');
  const ext = path.extname(fullPath);

  if (ext === '.js') {
    try {
      delete require.cache[fullPath];
      const loaded = require(fullPath);
      return { mod: loaded && loaded.default ? loaded.default : loaded, source };
    } catch {
      // Fall through to TypeScript / ESM transpilation fallback
    }
  }

  if (tsCompiler) {
    try {
      const transpiled = tsCompiler.transpileModule(source, {
        compilerOptions: {
          module: tsCompiler.ModuleKind.CommonJS,
          target: tsCompiler.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
        fileName: fullPath,
      });
      const tempMod = new Module(fullPath, module);
      tempMod.filename = fullPath;
      tempMod.paths = Module._nodeModulePaths(path.dirname(fullPath));
      tempMod._compile(transpiled.outputText, fullPath);
      const exp = tempMod.exports;
      return { mod: exp && exp.default ? exp.default : exp, source };
    } catch {
      // Fall through
    }
  }

  return { mod: null, source };
}

/**
 * Normalize a schema entry (which may be a ZodType or a plain shape object `{ key: z.string() }`)
 * into a Zod schema instance.
 *
 * @param {any} rawSchema
 * @returns {import('zod').ZodTypeAny | null}
 */
function normalizeZodSchema(rawSchema) {
  if (!rawSchema) return null;
  if (typeof rawSchema.parse === 'function' && rawSchema._def) {
    return rawSchema;
  }
  if (typeof rawSchema === 'object' && !Array.isArray(rawSchema)) {
    const entries = Object.entries(rawSchema);
    if (entries.length === 0) return z.object({});
    const isStatusMap = entries.every(([key]) => /^[1-5]\d\d$/.test(String(key)));
    if (isStatusMap) {
      return null;
    }
    const isShape = entries.every(([, val]) => val && typeof val === 'object' && ('_def' in val || typeof val.parse === 'function'));
    if (isShape) {
      return z.object(rawSchema);
    }
  }
  return null;
}

/**
 * Extract route parameter names from an Express route pattern (e.g. `/api/notes/:id` -> `['id']`).
 *
 * @param {string} routePath
 * @returns {string[]}
 */
function extractUrlParamNames(routePath) {
  const names = [];
  if (!routePath || typeof routePath !== 'string') return names;
  const regex = /:([a-zA-Z0-9_]+)/g;
  let match;
  while ((match = regex.exec(routePath)) !== null) {
    names.push(match[1]);
  }
  return names;
}

/**
 * Inspect a Zod schema to determine if any field accepts `File` / `Blob` (`zdb.file()`)
 * and extract static top-level field metadata for form contract checking and client coercion.
 *
 * @param {import('zod').ZodTypeAny | null} zSchema
 * @returns {{ acceptsFormData: boolean, fields: Record<string, { type: string, required: boolean, isFile: boolean, isArray: boolean }> | null, isStrictObject: boolean }}
 */
function inspectBodySchemaFields(zSchema) {
  if (!zSchema || !zSchema._def) {
    return { acceptsFormData: false, fields: null, isStrictObject: false };
  }

  let current = zSchema;
  while (current && current._def && (current._def.typeName === 'ZodEffects' || current._def.typeName === 'ZodOptional' || current._def.typeName === 'ZodDefault')) {
    current = current._def.schema || current._def.innerType;
  }

  if (!current || !current._def || current._def.typeName !== 'ZodObject') {
    return { acceptsFormData: false, fields: null, isStrictObject: false };
  }

  const shape = typeof current.shape === 'function' ? current.shape() : current.shape;
  if (!shape || typeof shape !== 'object') {
    return { acceptsFormData: false, fields: {}, isStrictObject: true };
  }

  let acceptsFormData = false;
  const fields = {};

  for (const [key, fieldSchema] of Object.entries(shape)) {
    let inner = fieldSchema;
    let required = true;
    let isArray = false;

    while (inner && inner._def) {
      const tName = inner._def.typeName;
      if (tName === 'ZodOptional' || tName === 'ZodDefault') {
        required = false;
        inner = inner._def.innerType;
      } else if (tName === 'ZodNullable') {
        inner = inner._def.innerType;
      } else if (tName === 'ZodEffects') {
        inner = inner._def.schema;
      } else if (tName === 'ZodArray') {
        isArray = true;
        inner = inner._def.type;
      } else {
        break;
      }
    }

    const isFile = Boolean(
      (fieldSchema && fieldSchema._zdbMeta && fieldSchema._zdbMeta.columnType === 'file') ||
      (inner && inner._zdbMeta && inner._zdbMeta.columnType === 'file')
    );
    if (isFile) acceptsFormData = true;

    const baseTypeName = inner && inner._def ? inner._def.typeName : 'ZodUnknown';
    let scalarKind = 'string';
    if (isFile) scalarKind = 'file';
    else if (baseTypeName === 'ZodNumber') scalarKind = 'number';
    else if (baseTypeName === 'ZodBoolean') scalarKind = 'boolean';
    else if (baseTypeName === 'ZodDate') scalarKind = 'date';

    fields[key] = {
      type: scalarKind,
      required,
      isFile,
      isArray,
    };
  }

  return {
    acceptsFormData,
    fields,
    isStrictObject: true,
  };
}

/**
 * Infer a TypeScript wire type from a handler function's source code / AST when no explicit
 * `response` Zod schema is provided.
 *
 * Understands:
 * - Streaming helpers: `res.sse()`, `res.streamText()`, `res.streamJson()`, `ctx.sse()`, etc.
 * - `apiResult(data, meta)` / `ctx.result(data, meta)` / `ctx.apiResult(data, meta)` / `res.apiResult(data, meta)`
 * - `res.status(204).end()` / `res.sendStatus(204)` -> `void`
 * - `res.json(data)` / `res.status(200).json(data)` / `return data`
 * - Object literals, shorthand identifiers resolved from local `const`/`let` declarations and `req.input.body.*`
 *
 * @param {Function|null} handlerFn
 * @param {string} fileSource
 * @param {{ bodySchema: any, querySchema: any, paramsSchema: any }} schemas
 * @param {Function} zodToTsTypeFn
 * @returns {{ responseType: string, isStreaming: boolean }}
 */
function inferHandlerWireResponse(handlerFn, fileSource, schemas, zodToTsTypeFn) {
  const src = String(
    (typeof handlerFn === 'function' ? Function.prototype.toString.call(handlerFn) : '') ||
    fileSource ||
    ''
  );

  if (!src.trim()) {
    return { responseType: 'unknown', isStreaming: false };
  }

  // 1. Detect streaming / raw endpoints
  if (/\b(?:res|ctx)\s*\.\s*(?:sse|streamText|streamJson)\s*\(/.test(src)) {
    return { responseType: 'never', isStreaming: true };
  }

  // 2. Build local variable type table from `req.input.body.<prop>` and literal assignments
  const bodyFieldTypes = {};
  if (schemas && schemas.bodySchema) {
    let current = schemas.bodySchema;
    while (current && current._def && (current._def.typeName === 'ZodEffects' || current._def.typeName === 'ZodOptional' || current._def.typeName === 'ZodDefault')) {
      current = current._def.schema || current._def.innerType;
    }
    if (current && current._def && current._def.typeName === 'ZodObject') {
      const shape = typeof current.shape === 'function' ? current.shape() : current.shape;
      if (shape) {
        for (const [k, v] of Object.entries(shape)) {
          bodyFieldTypes[k] = zodToTsTypeFn(v, 2, 'wire');
        }
      }
    }
  }

  const localVarTypes = new Map();
  const varDeclRegex = /\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*([^;\n]+);?/g;
  let declMatch;
  while ((declMatch = varDeclRegex.exec(src)) !== null) {
    const varName = declMatch[1];
    const rhs = declMatch[2].trim();
    const inferred = inferSimpleExpressionType(rhs, localVarTypes, bodyFieldTypes);
    if (inferred !== 'unknown') {
      localVarTypes.set(varName, inferred);
    }
  }

  // 3. Collect return expressions and res.json / res.apiResult / ctx.result payloads
  const candidateExprs = [];

  // Match `apiResult(expr, ...)` / `ctx.result(expr, ...)` / `ctx.apiResult(expr, ...)` / `res.apiResult(expr, ...)`
  const apiResultCalls = extractBalancedCallFirstArg(src, [
    'res.apiResult',
    'ctx.apiResult',
    'ctx.result',
    'apiResult',
  ]);
  for (const argExpr of apiResultCalls) {
    candidateExprs.push(argExpr);
  }

  // Match `res.status(...).json(expr)` or `res.json(expr)`
  const jsonCalls = extractBalancedCallFirstArg(src, ['json']);
  for (const argExpr of jsonCalls) {
    candidateExprs.push(argExpr);
  }

  // Match direct `return ...` statements that aren't `res.*` or `ctx.*` calls already captured
  const returnLiterals = extractReturnExpressions(src);
  for (const retExpr of returnLiterals) {
    if (
      !/^(?:await\s+)?(?:res|ctx)\s*\.\s*(?:status\s*\([^)]*\)\s*\.\s*)?(?:json|apiResult|result|end|sendStatus)\b/.test(retExpr) &&
      !/^(?:await\s+)?apiResult\s*\(/.test(retExpr)
    ) {
      candidateExprs.push(retExpr);
    }
  }

  if (candidateExprs.length === 0) {
    if (/\bres\s*\.\s*(?:status\s*\(\s*204\s*\)\s*\.\s*end|sendStatus\s*\(\s*204\s*\))/.test(src)) {
      return { responseType: 'void', isStreaming: false };
    }
    return { responseType: 'unknown', isStreaming: false };
  }

  const inferredTypes = [];
  for (const expr of candidateExprs) {
    const trimmed = expr.trim();
    if (!trimmed || trimmed === 'undefined') {
      inferredTypes.push('void');
      continue;
    }
    // If expr is itself a call to apiResult / ctx.result, unwrap first arg
    const nestedUnwrapped = extractBalancedCallFirstArg(trimmed, [
      'res.apiResult',
      'ctx.apiResult',
      'ctx.result',
      'apiResult',
    ]);
    const targetExpr = nestedUnwrapped.length > 0 ? nestedUnwrapped[0] : trimmed;
    const t = inferExpressionWireType(targetExpr, localVarTypes, bodyFieldTypes);
    if (t && !inferredTypes.includes(t)) {
      inferredTypes.push(t);
    }
  }

  if (inferredTypes.length === 0) {
    return { responseType: 'unknown', isStreaming: false };
  }
  const nonUnknown = inferredTypes.filter((t) => t !== 'unknown');
  const finalList = nonUnknown.length > 0 ? nonUnknown : inferredTypes;
  return {
    responseType: finalList.join(' | '),
    isStreaming: false,
  };
}

/**
 * Extract the first argument string of balanced calls to any of `fnNames`.
 *
 * @param {string} src
 * @param {string[]} fnNames
 * @returns {string[]}
 */
function extractBalancedCallFirstArg(src, fnNames) {
  const results = [];
  for (const fnName of fnNames) {
    const escaped = fnName.replace(/\./g, '\\s*\\.\\s*');
    const regex = new RegExp(`(?:^|[^a-zA-Z0-9_$])${escaped}\\s*\\(`, 'g');
    let match;
    while ((match = regex.exec(src)) !== null) {
      const openParenIdx = match.index + match[0].length - 1;
      const arg = readFirstCallArgument(src, openParenIdx);
      if (arg !== null) {
        results.push(arg.trim());
      }
    }
  }
  return results;
}

/**
 * Given the index of `(` in `src`, reads the first top-level argument up to `,` or matching `)`.
 *
 * @param {string} src
 * @param {number} openParenIdx
 * @returns {string|null}
 */
function readFirstCallArgument(src, openParenIdx) {
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let inString = null;
  const start = openParenIdx + 1;

  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    const prev = i > 0 ? src[i - 1] : '';

    if (inString) {
      if (ch === inString && prev !== '\\') {
        inString = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch;
      continue;
    }

    if (ch === '(') depthParen++;
    else if (ch === ')') {
      if (depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
        return src.slice(start, i);
      }
      depthParen--;
    } else if (ch === '{') depthBrace++;
    else if (ch === '}') depthBrace--;
    else if (ch === '[') depthBracket++;
    else if (ch === ']') depthBracket--;
    else if (ch === ',' && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      return src.slice(start, i);
    }
  }
  return null;
}

/**
 * Extract return statement expressions from function source.
 *
 * @param {string} src
 * @returns {string[]}
 */
function extractReturnExpressions(src) {
  const results = [];
  const regex = /\breturn\b\s*/g;
  let match;
  while ((match = regex.exec(src)) !== null) {
    const start = match.index + match[0].length;
    let depthParen = 0;
    let depthBrace = 0;
    let depthBracket = 0;
    let inString = null;
    let end = start;

    for (let i = start; i < src.length; i++) {
      const ch = src[i];
      const prev = i > 0 ? src[i - 1] : '';
      if (inString) {
        if (ch === inString && prev !== '\\') inString = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        inString = ch;
        continue;
      }
      if (ch === '(') depthParen++;
      else if (ch === ')') {
        if (depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
          end = i;
          break;
        }
        depthParen--;
      } else if (ch === '{') depthBrace++;
      else if (ch === '}') {
        if (depthBrace === 0 && depthParen === 0 && depthBracket === 0) {
          end = i;
          break;
        }
        depthBrace--;
      } else if (ch === '[') depthBracket++;
      else if (ch === ']') depthBracket--;
      else if ((ch === ';' || ch === '\n') && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
        end = i;
        break;
      }
      end = i + 1;
    }

    const expr = src.slice(start, end).trim();
    if (expr) results.push(expr);
  }
  return results;
}

/**
 * Infer a TypeScript type for simple expressions (numbers, strings, booleans, Dates, arrays, local vars).
 */
function inferSimpleExpressionType(expr, localVarTypes, bodyFieldTypes) {
  if (!expr) return 'unknown';
  const clean = expr.replace(/^await\s+/, '').trim();

  if (clean === 'true' || clean === 'false' || /^!\s*/.test(clean) || /^Boolean\s*\(/.test(clean)) {
    return 'boolean';
  }
  if (/^-?\d+(?:\.\d+)?$/.test(clean) || /^Number\s*\(/.test(clean) || /^parseInt\s*\(/.test(clean) || /^parseFloat\s*\(/.test(clean) || /^Math\./.test(clean)) {
    return 'number';
  }
  if (/^(?:'[^']*'|"[^"]*"|`[^`]*`)$/.test(clean) || /^String\s*\(/.test(clean) || /\.toISOString\s*\(\)/.test(clean)) {
    return 'string';
  }
  if (/^new\s+Date\s*\(/.test(clean)) {
    return 'string'; // Date serializes to ISO string on HTTP JSON wire
  }
  if (clean === 'null') return 'null';
  if (clean === 'undefined') return 'undefined';

  // Arithmetic addition/subtraction/multiplication where at least one side is numeric or counter
  if (/[+\-*/]\s*\d+|\b(?:count|total|amount|page|limit|length|size|index)\b\s*[+\-*/]/.test(clean)) {
    return 'number';
  }
  if (/\.length\b/.test(clean)) {
    return 'number';
  }

  // `req.input.body.xyz` or `ctx.input.body.xyz`
  const bodyPropMatch = clean.match(/\b(?:req|ctx)\.input\.body\.([a-zA-Z_$][a-zA-Z0-9_$]*)$/);
  if (bodyPropMatch && bodyFieldTypes && bodyFieldTypes[bodyPropMatch[1]]) {
    return bodyFieldTypes[bodyPropMatch[1]];
  }

  if (localVarTypes && localVarTypes.has(clean)) {
    return localVarTypes.get(clean);
  }

  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(clean)) {
    if (/^(?:count|total|amount|page|limit|offset|totalPages|version|index)$/.test(clean)) {
      return 'number';
    }
    if (/^(?:ok|success|deleted|updated|created|active|enabled|hasMore)$/.test(clean)) {
      return 'boolean';
    }
    if (/^(?:id|slug|title|name|message|status|query|filter|cursor|createdAt|updatedAt)$/.test(clean)) {
      return 'string';
    }
  }

  if (/\.id\b$/.test(clean)) {
    return 'number | string';
  }

  return 'unknown';
}

/**
 * Infer wire TypeScript type for an arbitrary returned expression (including object literals).
 */
function inferExpressionWireType(expr, localVarTypes, bodyFieldTypes) {
  const clean = expr.replace(/^await\s+/, '').trim();
  if (!clean) return 'void';

  if (clean.startsWith('{') && clean.endsWith('}')) {
    const inner = clean.slice(1, -1).trim();
    if (!inner) return 'Record<string, never>';
    const props = splitTopLevelCommas(inner);
    const propLines = [];

    for (const rawProp of props) {
      const prop = rawProp.trim();
      if (!prop || prop.startsWith('...')) continue;
      const colonIdx = findTopLevelColon(prop);
      if (colonIdx === -1) {
        // Shorthand property `{ count }`
        if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(prop)) {
          const valType = inferSimpleExpressionType(prop, localVarTypes, bodyFieldTypes);
          if (valType !== 'undefined' && valType !== 'void') {
            propLines.push(`${prop}: ${valType};`);
          }
        }
      } else {
        const keyPart = prop.slice(0, colonIdx).trim();
        const valPart = prop.slice(colonIdx + 1).trim();
        const valType = valPart.startsWith('{') && valPart.endsWith('}')
          ? inferExpressionWireType(valPart, localVarTypes, bodyFieldTypes)
          : inferSimpleExpressionType(valPart, localVarTypes, bodyFieldTypes);
        // Omit undefined properties on the JSON wire
        if (valType === 'undefined' || valType === 'void') continue;
        propLines.push(`${keyPart}: ${valType};`);
      }
    }

    if (propLines.length === 0) return 'Record<string, never>';
    return `{ ${propLines.join(' ')} }`;
  }

  if (clean.startsWith('[') && clean.endsWith(']')) {
    return 'Array<unknown>';
  }

  return inferSimpleExpressionType(clean, localVarTypes, bodyFieldTypes);
}

function splitTopLevelCommas(str) {
  const parts = [];
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let inString = null;
  let lastIdx = 0;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const prev = i > 0 ? str[i - 1] : '';
    if (inString) {
      if (ch === inString && prev !== '\\') inString = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '(') depthParen++;
    else if (ch === ')') depthParen--;
    else if (ch === '{') depthBrace++;
    else if (ch === '}') depthBrace--;
    else if (ch === '[') depthBracket++;
    else if (ch === ']') depthBracket--;
    else if (ch === ',' && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      parts.push(str.slice(lastIdx, i));
      lastIdx = i + 1;
    }
  }
  parts.push(str.slice(lastIdx));
  return parts;
}

function findTopLevelColon(str) {
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let inString = null;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const prev = i > 0 ? str[i - 1] : '';
    if (inString) {
      if (ch === inString && prev !== '\\') inString = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '(') depthParen++;
    else if (ch === ')') depthParen--;
    else if (ch === '{') depthBrace++;
    else if (ch === '}') depthBrace--;
    else if (ch === '[') depthBracket++;
    else if (ch === ']') depthBracket--;
    else if (ch === ':' && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      return i;
    }
  }
  return -1;
}

/**
 * Collect all API route contracts from the project (`pages/api`, `src/pages/api`, `src/api`, and modules).
 *
 * @param {string} rootDir
 * @param {Object} [options]
 * @param {string} [options.pagesDir]
 * @param {Function} options.zodToTsType
 * @returns {Array<Object>}
 */
function collectApiRouteContracts(rootDir, options = {}) {
  const zodToTsTypeFn = options.zodToTsType;
  const pagesRelDir =
    options.pagesDir ||
    (fs.existsSync(path.join(rootDir, 'src/pages')) ? 'src/pages' : 'pages');

  const candidateDirs = [
    { dir: path.resolve(rootDir, pagesRelDir, 'api'), prefix: '/api' },
    { dir: path.resolve(rootDir, 'src/api'), prefix: '/api' },
  ];

  // Also include standard scanRoutes API descriptors (e.g. modular routes)
  const seenFiles = new Set();
  const rawRouteEntries = [];

  for (const { dir, prefix } of candidateDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = scanApiFilesIncludingTs(dir, dir);
    for (const { absolutePath, relativePath } of files) {
      if (seenFiles.has(absolutePath)) continue;
      const parsed = parseFileRoute(relativePath, { type: 'api', prefix });
      if (parsed && parsed.isValid) {
        seenFiles.add(absolutePath);
        rawRouteEntries.push({
          method: (parsed.method || 'GET').toUpperCase(),
          path: parsed.path,
          file: absolutePath,
          sourceRel: path.relative(rootDir, absolutePath).replace(/\\/g, '/'),
        });
      }
    }
  }

  try {
    const pagesDir = path.resolve(rootDir, pagesRelDir);
    const apiRel = path.join(pagesRelDir, 'api');
    const scanned = scanRoutes({
      rootDir,
      pages: fs.existsSync(pagesDir) ? { dir: pagesRelDir } : false,
      api: fs.existsSync(path.resolve(rootDir, apiRel)) ? { dir: apiRel } : false,
    });
    for (const d of scanned) {
      if (d.type !== 'api' || !d.file || seenFiles.has(d.file) || isClientBrowserFile(d.file)) {
        continue;
      }
      seenFiles.add(d.file);
      rawRouteEntries.push({
        method: (d.method || 'GET').toUpperCase(),
        path: d.path || d.pattern,
        file: d.file,
        sourceRel: path.relative(rootDir, d.file).replace(/\\/g, '/'),
      });
    }
  } catch {
    // Ignore scan errors
  }

  rawRouteEntries.sort((a, b) => {
    const cmp = a.path.localeCompare(b.path);
    return cmp !== 0 ? cmp : a.method.localeCompare(b.method);
  });

  const contracts = [];

  for (const entry of rawRouteEntries) {
    const { mod, source } = loadApiRouteModule(entry.file);
    const def = mod && typeof mod === 'object' ? mod : {};

    let rawSchema = def.schema;
    if (typeof rawSchema === 'function') {
      try {
        rawSchema = rawSchema({ z, zdb });
      } catch {
        rawSchema = null;
      }
    }

    const bodySchema = rawSchema && rawSchema.body ? normalizeZodSchema(rawSchema.body) : null;
    const querySchema = rawSchema && rawSchema.query ? normalizeZodSchema(rawSchema.query) : null;
    const paramsSchema = rawSchema && rawSchema.params ? normalizeZodSchema(rawSchema.params) : null;

    const urlParamNames = extractUrlParamNames(entry.path);
    let defaultParamsType = 'Record<string, never>';
    if (urlParamNames.length > 0) {
      defaultParamsType = `{ ${urlParamNames.map((p) => `${p}: string | number`).join('; ')} }`;
    }

    const inputBodyType = bodySchema
      ? zodToTsTypeFn(bodySchema, 4, 'input')
      : 'undefined';
    const parsedBodyType = bodySchema
      ? zodToTsTypeFn(bodySchema, 4, 'output')
      : 'undefined';

    const inputQueryType = querySchema
      ? zodToTsTypeFn(querySchema, 4, 'input')
      : 'Record<string, string | number | boolean | undefined>';
    const parsedQueryType = querySchema
      ? zodToTsTypeFn(querySchema, 4, 'output')
      : 'Record<string, string | undefined>';

    const inputParamsType = paramsSchema
      ? zodToTsTypeFn(paramsSchema, 4, 'input')
      : defaultParamsType;
    const parsedParamsType = paramsSchema
      ? zodToTsTypeFn(paramsSchema, 4, 'output')
      : defaultParamsType;

    const bodyInspection = inspectBodySchemaFields(bodySchema);
    const queryInspection = inspectBodySchemaFields(querySchema);

    // Determine response type & streaming status
    let responseType = 'unknown';
    let isStreaming = false;

    const explicitResponse =
      def.response ||
      (rawSchema && rawSchema.response ? rawSchema.response : null);

    if (explicitResponse) {
      const directZod = normalizeZodSchema(explicitResponse);
      if (directZod) {
        responseType = zodToTsTypeFn(directZod, 3, 'wire');
      } else if (typeof explicitResponse === 'object') {
        if (
          (explicitResponse[204] || explicitResponse['204']) &&
          !explicitResponse[200] &&
          !explicitResponse['200'] &&
          !explicitResponse[201] &&
          !explicitResponse['201']
        ) {
          responseType = 'void';
        } else {
          const statusSchemas = [
            explicitResponse[200] || explicitResponse['200'],
            explicitResponse[201] || explicitResponse['201'],
          ]
            .map((s) => normalizeZodSchema(s))
            .filter(Boolean);
          if (statusSchemas.length > 0) {
            responseType = statusSchemas
              .map((s) => zodToTsTypeFn(s, 3, 'wire'))
              .join(' | ');
          }
        }
      }
    }

    if (responseType === 'unknown') {
      const inferred = inferHandlerWireResponse(
        def.handler || (typeof mod === 'function' ? mod : null),
        source,
        { bodySchema, querySchema, paramsSchema },
        zodToTsTypeFn
      );
      responseType = inferred.responseType;
      isStreaming = inferred.isStreaming;
    }

    contracts.push({
      method: entry.method,
      path: entry.path,
      file: entry.file,
      sourceRel: entry.sourceRel,
      hasBodySchema: Boolean(bodySchema),
      hasQuerySchema: Boolean(querySchema),
      hasParamsSchema: Boolean(paramsSchema),
      urlParamNames,
      inputBodyType,
      parsedBodyType,
      inputQueryType,
      parsedQueryType,
      inputParamsType,
      parsedParamsType,
      responseType,
      isStreaming,
      acceptsFormData: bodyInspection.acceptsFormData,
      bodyFields: bodyInspection.fields,
      isStrictBodyObject: bodyInspection.isStrictObject,
      queryFields: queryInspection.fields,
      isStrictQueryObject: queryInspection.isStrictObject,
    });
  }

  return contracts;
}

/**
 * Generate the `.webspresso/api.d.ts` TypeScript manifest content.
 *
 * @param {Array<Object>} contracts
 * @returns {string}
 */
function generateApiDeclarationCode(contracts = []) {
  const timestamp = new Date().toISOString();

  let code = `/**
 * Webspresso Typed API & Form Contract Manifest
 * Auto-generated on ${timestamp}
 * DO NOT EDIT DIRECTLY. Regenerated automatically during dev and build.
 */

export type HttpWirePrimitive = string | number | boolean | null;

/**
 * Models HTTP JSON wire serialization:
 * - Date & BigInt serialize to string
 * - Unwraps Webspresso apiResult({ data, invalidate }) envelopes
 * - Strips undefined-only properties
 */
export type WireSerialize<T> =
  T extends void | undefined ? void :
  T extends Date | bigint ? string :
  T extends HttpWirePrimitive ? T :
  T extends { __webspressoApiResult: true; data: infer D } ? WireSerialize<D> :
  T extends Array<infer U> ? Array<WireSerialize<U>> :
  T extends object ? {
    [K in keyof T as [T[K]] extends [undefined | void] ? never : K]: WireSerialize<T[K]>;
  } :
  unknown;

export type ConcurrencyPolicy = 'latest' | 'drop' | 'queue' | 'parallel';

export interface ApiCallOptions<TQuery = Record<string, unknown>, TParams = Record<string, string | number>> {
  query?: TQuery;
  params?: TParams;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  key?: string;
  concurrency?: ConcurrencyPolicy;
  formData?: boolean;
}

/* ============================================================================
 * Discovered API Route Contracts (Input vs Server Parsed vs HTTP Wire Output)
 * ========================================================================= */

export interface WebspressoApiRouteMap {
`;

  // Group contracts by method -> path
  const byMethod = {
    GET: [],
    POST: [],
    PUT: [],
    PATCH: [],
    DELETE: [],
  };

  for (const c of contracts) {
    const m = c.method.toUpperCase();
    if (!byMethod[m]) byMethod[m] = [];
    byMethod[m].push(c);
  }

  for (const [method, list] of Object.entries(byMethod)) {
    if (list.length === 0) {
      code += `  ${method}: Record<string, never>;\n`;
      continue;
    }
    code += `  ${method}: {\n`;
    for (const c of list) {
      code += `    /** Source: ${c.sourceRel} */\n`;
      code += `    '${c.path}': {\n`;
      code += `      input: {\n`;
      code += `        body: ${c.inputBodyType};\n`;
      code += `        query: ${c.inputQueryType};\n`;
      code += `        params: ${c.inputParamsType};\n`;
      code += `      };\n`;
      code += `      parsed: {\n`;
      code += `        body: ${c.parsedBodyType};\n`;
      code += `        query: ${c.parsedQueryType};\n`;
      code += `        params: ${c.parsedParamsType};\n`;
      code += `      };\n`;
      code += `      response: ${c.isStreaming ? 'never' : `WireSerialize<${c.responseType}>`};\n`;
      code += `      acceptsFormData: ${c.acceptsFormData ? 'true' : 'false'};\n`;
      code += `      isStreaming: ${c.isStreaming ? 'true' : 'false'};\n`;
      code += `    };\n`;
    }
    code += `  };\n`;
  }

  code += `}

declare module 'webspresso' {
  interface AppApiRouteMap extends WebspressoApiRouteMap {}
}

export type ApiMethod = keyof WebspressoApiRouteMap;

export type NonStreamingPaths<M extends ApiMethod> = {
  [P in keyof WebspressoApiRouteMap[M]]: WebspressoApiRouteMap[M][P] extends { isStreaming: true } ? never : P;
}[keyof WebspressoApiRouteMap[M]] & string;

export type StreamingOrAnyPaths<M extends ApiMethod> = (keyof WebspressoApiRouteMap[M] & string) | (string & {});

export type RouteInputBody<M extends ApiMethod, P extends keyof WebspressoApiRouteMap[M]> =
  WebspressoApiRouteMap[M][P] extends { input: { body: infer B } } ? B : unknown;

export type RouteInputQuery<M extends ApiMethod, P extends keyof WebspressoApiRouteMap[M]> =
  WebspressoApiRouteMap[M][P] extends { input: { query: infer Q } } ? Q : Record<string, unknown>;

export type RouteInputParams<M extends ApiMethod, P extends keyof WebspressoApiRouteMap[M]> =
  WebspressoApiRouteMap[M][P] extends { input: { params: infer R } } ? R : Record<string, string | number>;

export type RouteWireResponse<M extends ApiMethod, P extends keyof WebspressoApiRouteMap[M]> =
  WebspressoApiRouteMap[M][P] extends { response: infer Res } ? Res : unknown;

export type RouteBodyArg<M extends ApiMethod, P extends keyof WebspressoApiRouteMap[M]> =
  WebspressoApiRouteMap[M][P] extends { acceptsFormData: true }
    ? RouteInputBody<M, P> | FormData
    : RouteInputBody<M, P>;

export interface TypedApiClient {
  get<P extends NonStreamingPaths<'GET'>>(
    url: P,
    options?: ApiCallOptions<RouteInputQuery<'GET', P>, RouteInputParams<'GET', P>>
  ): Promise<RouteWireResponse<'GET', P>>;

  post<P extends NonStreamingPaths<'POST'>>(
    url: P,
    ...args: [RouteInputBody<'POST', P>] extends [undefined]
      ? [body?: undefined, options?: ApiCallOptions<RouteInputQuery<'POST', P>, RouteInputParams<'POST', P>>]
      : [body: RouteBodyArg<'POST', P>, options?: ApiCallOptions<RouteInputQuery<'POST', P>, RouteInputParams<'POST', P>>]
  ): Promise<RouteWireResponse<'POST', P>>;

  put<P extends NonStreamingPaths<'PUT'>>(
    url: P,
    ...args: [RouteInputBody<'PUT', P>] extends [undefined]
      ? [body?: undefined, options?: ApiCallOptions<RouteInputQuery<'PUT', P>, RouteInputParams<'PUT', P>>]
      : [body: RouteBodyArg<'PUT', P>, options?: ApiCallOptions<RouteInputQuery<'PUT', P>, RouteInputParams<'PUT', P>>]
  ): Promise<RouteWireResponse<'PUT', P>>;

  patch<P extends NonStreamingPaths<'PATCH'>>(
    url: P,
    ...args: [RouteInputBody<'PATCH', P>] extends [undefined]
      ? [body?: undefined, options?: ApiCallOptions<RouteInputQuery<'PATCH', P>, RouteInputParams<'PATCH', P>>]
      : [body: RouteBodyArg<'PATCH', P>, options?: ApiCallOptions<RouteInputQuery<'PATCH', P>, RouteInputParams<'PATCH', P>>]
  ): Promise<RouteWireResponse<'PATCH', P>>;

  delete<P extends NonStreamingPaths<'DELETE'>>(
    url: P,
    ...args: [RouteInputBody<'DELETE', P>] extends [undefined]
      ? [body?: undefined, options?: ApiCallOptions<RouteInputQuery<'DELETE', P>, RouteInputParams<'DELETE', P>>]
      : [body: RouteBodyArg<'DELETE', P>, options?: ApiCallOptions<RouteInputQuery<'DELETE', P>, RouteInputParams<'DELETE', P>>]
  ): Promise<RouteWireResponse<'DELETE', P>>;

  /**
   * Honest escape hatch for arbitrary non-JSON or custom endpoints.
   */
  raw(url: StreamingOrAnyPaths<ApiMethod>, options?: RequestInit & ApiCallOptions): Promise<Response>;

  /**
   * Honest escape hatch for streaming (SSE / NDJSON / chunked text) endpoints.
   */
  stream(url: StreamingOrAnyPaths<ApiMethod>, options?: ApiCallOptions): Promise<ReadableStream<Uint8Array> | Response>;
}

export interface TypedFormHandle<
  M extends ApiMethod = 'POST',
  P extends keyof WebspressoApiRouteMap[M] = keyof WebspressoApiRouteMap[M]
> {
  readonly name: string;
  readonly el: HTMLFormElement | null;
  readonly pending: boolean;
  readonly dirty: boolean;
  readonly formError: string;
  readonly fieldErrors: Partial<Record<keyof RouteInputBody<M, P> & string, string>> & Record<string, string>;
  values(): RouteInputBody<M, P>;
  reset(): void;
  clear(): void;
  setErrors(fieldErrors?: Partial<Record<keyof RouteInputBody<M, P> & string, string>>, formError?: string): void;
  clearErrors(): void;
  submit(submitter?: HTMLElement | null): Promise<{
    ok: boolean;
    data?: RouteWireResponse<M, P>;
    refreshOk?: boolean;
    refreshError?: Error | null;
    error?: Error;
  }>;
  onSuccess(callback: (data: RouteWireResponse<M, P>, meta: { refreshOk: boolean; refreshError: Error | null }) => void): () => void;
}
`;

  return code;
}

/**
 * Scan HTML / Nunjucks templates and compare static `<form action="/api/...">` field names
 * against the discovered API route schemas.
 *
 * - Reports an error if a static field name does not exist in the target route's strict object schema.
 * - Reports a warning (not false certainty) when dynamic Nunjucks expressions are used in `name="..."` or `action="..."`.
 *
 * @param {string} rootDir
 * @param {Object} [options]
 * @param {Array<Object>} [options.contracts]
 * @param {Function} [options.zodToTsType]
 * @returns {{ errors: Array<Object>, warnings: Array<Object>, checkedFormsCount: number }}
 */
function checkTemplateFormContracts(rootDir, options = {}) {
  const contracts =
    options.contracts ||
    collectApiRouteContracts(rootDir, {
      pagesDir: options.pagesDir,
      zodToTsType: options.zodToTsType || (() => 'unknown'),
    });

  const contractMap = new Map();
  for (const c of contracts) {
    contractMap.set(`${c.method.toUpperCase()} ${c.path}`, c);
  }

  const templateDirs = [
    path.resolve(rootDir, options.pagesDir || 'pages'),
    path.resolve(rootDir, 'src/pages'),
    path.resolve(rootDir, 'views'),
    path.resolve(rootDir, 'src/views'),
  ];

  const seenTemplates = new Set();
  const templateFiles = [];

  function walkTemplates(dir) {
    if (!fs.existsSync(dir)) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkTemplates(full);
      } else if (entry.isFile() && (entry.name.endsWith('.njk') || entry.name.endsWith('.html'))) {
        if (!seenTemplates.has(full)) {
          seenTemplates.add(full);
          templateFiles.push(full);
        }
      }
    }
  }

  for (const d of templateDirs) {
    walkTemplates(d);
  }

  const errors = [];
  const warnings = [];
  let checkedFormsCount = 0;

  const formRegex = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  const controlRegex = /<(?:input|select|textarea|button)\b([^>]*)>/gi;

  for (const tplFile of templateFiles) {
    const relFile = path.relative(rootDir, tplFile).replace(/\\/g, '/');
    let content = '';
    try {
      content = fs.readFileSync(tplFile, 'utf8');
    } catch {
      continue;
    }

    let formMatch;
    while ((formMatch = formRegex.exec(content)) !== null) {
      const formAttrs = formMatch[1] || '';
      const formInner = formMatch[2] || '';

      const actionMatch = formAttrs.match(/\baction\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      if (!actionMatch) continue;
      const actionRaw = (actionMatch[1] ?? actionMatch[2] ?? '').trim();
      if (!actionRaw) continue;

      const methodMatch = formAttrs.match(/\bmethod\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const method = ((methodMatch ? (methodMatch[1] ?? methodMatch[2]) : 'GET') || 'GET').trim().toUpperCase();

      // Dynamic action URL expression
      if (actionRaw.includes('{{') || actionRaw.includes('{%')) {
        // Attempt to normalize dynamic parameter segments like `/api/notes/{{ note.id }}` -> `/api/notes/:param`
        const normalizedPattern = actionRaw
          .split('?')[0]
          .replace(/\{\{[^}]+\}\}/g, ':param');
        const matchedDynamic = contracts.find(
          (c) =>
            c.method === method &&
            c.path.replace(/:[a-zA-Z0-9_]+/g, ':param') === normalizedPattern
        );
        if (!matchedDynamic) {
          warnings.push({
            code: 'DYNAMIC_FORM_ACTION',
            file: relFile,
            action: actionRaw,
            method,
            message: `Form in "${relFile}" uses dynamic action "${actionRaw}" (${method}); static route contract cannot be resolved with certainty.`,
          });
          continue;
        }
        verifyFormControlsAgainstContract(
          matchedDynamic,
          formInner,
          relFile,
          actionRaw,
          method,
          controlRegex,
          errors,
          warnings
        );
        checkedFormsCount++;
        continue;
      }

      const cleanActionPath = actionRaw.split('?')[0];
      if (!cleanActionPath.startsWith('/api/')) continue;

      checkedFormsCount++;

      // Find exact or parameterized route match
      let targetContract = contractMap.get(`${method} ${cleanActionPath}`);
      if (!targetContract) {
        targetContract = contracts.find((c) => {
          if (c.method !== method) return false;
          const regexStr = '^' + c.path.replace(/:[a-zA-Z0-9_]+/g, '[^/]+') + '$';
          return new RegExp(regexStr).test(cleanActionPath);
        });
      }

      if (!targetContract) {
        errors.push({
          code: 'MISSING_FORM_ACTION_ROUTE',
          file: relFile,
          action: cleanActionPath,
          method,
          message: `Form in "${relFile}" targets "${method} ${cleanActionPath}", which does not match any discovered API route.`,
        });
        continue;
      }

      verifyFormControlsAgainstContract(
        targetContract,
        formInner,
        relFile,
        cleanActionPath,
        method,
        controlRegex,
        errors,
        warnings
      );
    }
  }

  return {
    errors,
    warnings,
    checkedFormsCount,
  };
}

function verifyFormControlsAgainstContract(
  contract,
  formInner,
  relFile,
  action,
  method,
  controlRegex,
  errors,
  warnings
) {
  const targetFields = method === 'GET' ? contract.queryFields : contract.bodyFields;
  const isStrict = method === 'GET' ? contract.isStrictQueryObject : contract.isStrictBodyObject;
  if (!isStrict || !targetFields) return;

  controlRegex.lastIndex = 0;
  let ctrlMatch;
  while ((ctrlMatch = controlRegex.exec(formInner)) !== null) {
    const attrs = ctrlMatch[1] || '';
    const nameMatch = attrs.match(/\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (!nameMatch) continue;
    const rawName = (nameMatch[1] ?? nameMatch[2] ?? '').trim();
    if (!rawName) continue;

    // Ignore CSRF fields
    if (rawName === '_csrf' || rawName === 'csrfToken') continue;

    if (rawName.includes('{{') || rawName.includes('{%')) {
      warnings.push({
        code: 'DYNAMIC_FORM_FIELD_NAME',
        file: relFile,
        action,
        method,
        field: rawName,
        message: `Form in "${relFile}" (${method} ${action}) has dynamic field name "${rawName}"; skipping static schema check to avoid false certainty.`,
      });
      continue;
    }

    const normalizedName = rawName.endsWith('[]') ? rawName.slice(0, -2) : rawName;
    if (!Object.prototype.hasOwnProperty.call(targetFields, normalizedName)) {
      errors.push({
        code: 'UNKNOWN_FORM_FIELD',
        file: relFile,
        action,
        method,
        field: normalizedName,
        allowedFields: Object.keys(targetFields),
        message: `Form in "${relFile}" (${method} ${action}) defines field name="${rawName}", which is not declared in ${contract.sourceRel} schema (${Object.keys(targetFields).join(', ') || 'none'}).`,
      });
    }
  }
}

module.exports = {
  scanApiFilesIncludingTs,
  loadApiRouteModule,
  normalizeZodSchema,
  inspectBodySchemaFields,
  inferHandlerWireResponse,
  collectApiRouteContracts,
  generateApiDeclarationCode,
  checkTemplateFormContracts,
};

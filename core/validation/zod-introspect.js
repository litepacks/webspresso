/**
 * Zod v3 & v4 Introspection Helpers
 * Provides a unified abstraction over Zod v3 (`_def.typeName`) and Zod v4 (`_zod.def.type`)
 * for ORM column inference, TypeGen, API TypeGen, and OpenAPI/MCP JSON Schema generation.
 * @module core/validation/zod-introspect
 */

const z = require('zod');

const V4_TYPE_MAP = Object.freeze({
  string: 'ZodString',
  number: 'ZodNumber',
  boolean: 'ZodBoolean',
  date: 'ZodDate',
  bigint: 'ZodBigInt',
  any: 'ZodAny',
  unknown: 'ZodUnknown',
  never: 'ZodNever',
  undefined: 'ZodUndefined',
  void: 'ZodVoid',
  null: 'ZodNull',
  literal: 'ZodLiteral',
  enum: 'ZodEnum',
  array: 'ZodArray',
  optional: 'ZodOptional',
  nullable: 'ZodNullable',
  default: 'ZodDefault',
  prefault: 'ZodDefault',
  transform: 'ZodEffects',
  pipe: 'ZodPipeline',
  union: 'ZodUnion',
  object: 'ZodObject',
  record: 'ZodRecord',
  tuple: 'ZodTuple',
  set: 'ZodSet',
  map: 'ZodMap',
  nonoptional: 'ZodNonOptional',
  readonly: 'ZodReadonly',
  catch: 'ZodCatch',
});

function getZodDef(schema) {
  if (!schema || typeof schema !== 'object') return null;
  return (schema._zod && schema._zod.def) || schema._def || null;
}

function getZodTypeName(schema) {
  const def = getZodDef(schema);
  if (!def) return null;
  if (def.typeName) return def.typeName;
  if (typeof def.type === 'string') {
    return V4_TYPE_MAP[def.type] || null;
  }
  return null;
}

function isZodSchema(val) {
  return Boolean(val && typeof val === 'object' && (val._zod || val._def) && typeof val.safeParse === 'function');
}

function getZodInner(schema) {
  const def = getZodDef(schema);
  if (!def) return null;
  return def.innerType || def.schema || def.in || null;
}

function getZodPipeOut(schema) {
  const def = getZodDef(schema);
  if (!def) return null;
  return def.out || null;
}

function getZodArrayElement(schema) {
  const def = getZodDef(schema);
  if (!def) return null;
  if (def.element) return def.element;
  if (def.type && typeof def.type === 'object') return def.type;
  return null;
}

function getZodObjectShape(schema) {
  if (!schema || typeof schema !== 'object') return {};
  if (typeof schema.shape === 'object' && schema.shape !== null) return schema.shape;
  const def = getZodDef(schema);
  if (!def) return {};
  if (typeof def.shape === 'function') return def.shape() || {};
  if (typeof def.shape === 'object' && def.shape !== null) return def.shape;
  return {};
}

function getZodEnumValues(schema) {
  const def = getZodDef(schema);
  if (!def) return [];
  if (Array.isArray(def.values)) return def.values;
  if (def.entries && typeof def.entries === 'object') return Object.values(def.entries);
  if (def.values && typeof def.values === 'object') return Object.values(def.values);
  return [];
}

function getZodLiteralValue(schema) {
  const def = getZodDef(schema);
  if (!def) return undefined;
  if (def.value !== undefined) return def.value;
  if (Array.isArray(def.values)) return def.values[0];
  return undefined;
}

function isZodInt(schema) {
  const def = getZodDef(schema);
  if (!def) return false;
  if (def.format === 'safeint' || def.format === 'int32' || def.format === 'uint32') return true;
  if (!Array.isArray(def.checks)) return false;
  return def.checks.some((c) => {
    if (!c) return false;
    if (c.kind === 'int') return true;
    const cDef = c._zod && c._zod.def;
    return Boolean(cDef && cDef.check === 'number_format' && (cDef.format === 'safeint' || cDef.format === 'int32'));
  });
}

function isZodCoerced(schema) {
  const def = getZodDef(schema);
  return Boolean(def && def.coerce);
}

function zodToJsonSchemaCompat(schema, options = {}) {
  if (typeof z.toJSONSchema === 'function') {
    try {
      const target = options.target === 'openApi3' ? 'openapi-3.0' : (options.target || 'draft-7');
      const jsonSchema = z.toJSONSchema(schema, {
        target,
        unrepresentable: 'any',
      });
      if (jsonSchema && typeof jsonSchema === 'object') {
        delete jsonSchema.$schema;
      }
      return jsonSchema;
    } catch (_) {
      // Fall through to legacy helper if needed
    }
  }
  const { zodToJsonSchema } = require('zod-to-json-schema');
  return zodToJsonSchema(schema, options);
}

/**
 * Apply Zod v3 compatibility shims onto Zod v4 prototypes (idempotent).
 * - Exposes `ZodError.prototype.errors` -> `this.issues`
 */
function ensureZodCompat(zodModule = z) {
  if (!zodModule) return;

  const sampleError = typeof zodModule.string === 'function'
    ? zodModule.string().safeParse(123)?.error
    : null;
  const errProtos = [
    sampleError ? Object.getPrototypeOf(sampleError) : null,
    zodModule.ZodError?.prototype,
  ];
  for (const errProto of errProtos) {
    if (errProto && !Object.getOwnPropertyDescriptor(errProto, 'errors')) {
      Object.defineProperty(errProto, 'errors', {
        get() {
          return this.issues;
        },
        configurable: true,
      });
    }
  }
}

module.exports = {
  getZodDef,
  getZodTypeName,
  isZodSchema,
  getZodInner,
  getZodPipeOut,
  getZodArrayElement,
  getZodObjectShape,
  getZodEnumValues,
  getZodLiteralValue,
  isZodInt,
  isZodCoerced,
  zodToJsonSchemaCompat,
  ensureZodCompat,
};


/**
 * Webspresso ORM - Schema Helpers
 * Wraps Zod with database metadata helpers
 * @module core/orm/schema-helpers
 */

const { safeJsonParse } = require('../utils/json');

const METADATA_MARKER = '__wdb__';
const metaWeakMap = new WeakMap();
const metaStringCache = new Map();
const schemaColumnsWeakMap = new WeakMap();

/**
 * Encode column metadata into a JSON string for Zod .describe()
 * @param {import('./types').ColumnMeta} meta - Column metadata
 * @returns {string} JSON-encoded metadata
 */
function encodeColumnMeta(meta) {
  return JSON.stringify({ [METADATA_MARKER]: true, meta });
}

/**
 * Decode column metadata from Zod .describe() string
 * @param {string} description - Zod description string
 * @returns {import('./types').ColumnMeta|null} Decoded metadata or null
 */
function decodeColumnMeta(description) {
  if (!description) return null;
  const cached = metaStringCache.get(description);
  if (cached !== undefined) return cached;

  const parsed = safeJsonParse(description, null);
  if (parsed && parsed[METADATA_MARKER]) {
    const meta = parsed.meta;
    if (metaStringCache.size < 500) {
      metaStringCache.set(description, meta);
    }
    return meta;
  }

  if (metaStringCache.size < 500) {
    metaStringCache.set(description, null);
  }
  return null;
}

/**
 * Check if a Zod schema has ORM column metadata
 * @param {import('zod').ZodTypeAny} schema - Zod schema
 * @returns {boolean}
 */
function hasColumnMeta(schema) {
  return getColumnMeta(schema) !== null;
}

/**
 * Get column metadata from a Zod schema
 * @param {import('zod').ZodTypeAny} schema - Zod schema
 * @returns {import('./types').ColumnMeta|null}
 */
function getColumnMeta(schema) {
  if (!schema) return null;
  const direct = metaWeakMap.get(schema);
  if (direct !== undefined) return direct;
  if (schema._wdbMeta) return schema._wdbMeta;
  return decodeColumnMeta(schema.description);
}

/**
 * SchemaBuilder - Chainable wrapper for Zod schemas with validation and UI metadata
 * @class
 */
class SchemaBuilder {
  /**
   * @param {import('zod').ZodTypeAny} schema - Base Zod schema
   * @param {import('./types').ColumnMeta} baseMeta - Base column metadata
   * @param {typeof import('zod').z} z - Zod instance
   */
  constructor(schema, baseMeta, z) {
    this._schema = schema;
    this._baseMeta = { ...baseMeta };
    this._validations = {};
    this._ui = {};
    this._z = z;
    this._finalized = false;
  }

  /**
   * Proxy all Zod validation methods
   */
  min(value) {
    this._validations.min = value;
    if (typeof this._schema.min === 'function') {
      this._schema = this._schema.min(value);
    }
    return this;
  }

  max(value) {
    this._validations.max = value;
    if (typeof this._schema.max === 'function') {
      this._schema = this._schema.max(value);
    }
    return this;
  }

  length(value) {
    this._validations.length = value;
    if (typeof this._schema.length === 'function') {
      this._schema = this._schema.length(value);
    }
    return this;
  }

  minLength(value) {
    this._validations.minLength = value;
    if (typeof this._schema.min === 'function') {
      this._schema = this._schema.min(value);
    }
    return this;
  }

  maxLength(value) {
    this._validations.maxLength = value;
    if (typeof this._schema.max === 'function') {
      this._schema = this._schema.max(value);
    }
    return this;
  }

  email() {
    this._validations.email = true;
    if (typeof this._schema.email === 'function') {
      this._schema = this._schema.email();
    }
    return this;
  }

  url() {
    this._validations.url = true;
    if (typeof this._schema.url === 'function') {
      this._schema = this._schema.url();
    }
    return this;
  }

  pattern(regex) {
    const patternStr = regex instanceof RegExp ? regex.source : regex;
    this._validations.pattern = patternStr;
    if (typeof this._schema.regex === 'function') {
      this._schema = this._schema.regex(regex);
    }
    return this;
  }

  includes(str) {
    this._validations.includes = str;
    if (typeof this._schema.includes === 'function') {
      this._schema = this._schema.includes(str);
    }
    return this;
  }

  startsWith(str) {
    this._validations.startsWith = str;
    if (typeof this._schema.startsWith === 'function') {
      this._schema = this._schema.startsWith(str);
    }
    return this;
  }

  endsWith(str) {
    this._validations.endsWith = str;
    if (typeof this._schema.endsWith === 'function') {
      this._schema = this._schema.endsWith(str);
    }
    return this;
  }

  positive() {
    this._validations.positive = true;
    if (typeof this._schema.positive === 'function') {
      this._schema = this._schema.positive();
    }
    return this;
  }

  negative() {
    this._validations.negative = true;
    if (typeof this._schema.negative === 'function') {
      this._schema = this._schema.negative();
    }
    return this;
  }

  int() {
    this._validations.int = true;
    if (typeof this._schema.int === 'function') {
      this._schema = this._schema.int();
    }
    return this;
  }

  step(value) {
    this._validations.step = value;
    // Zod doesn't have step, but we store it for UI
    return this;
  }

  nonempty() {
    this._validations.nonempty = true;
    if (typeof this._schema.min === 'function') {
      this._schema = this._schema.min(1);
    } else if (typeof this._schema.length === 'function') {
      this._schema = this._schema.min(1);
    }
    return this;
  }

  nullable() {
    this._baseMeta.nullable = true;
    if (this._schema.nullable) {
      this._schema = this._schema.nullable();
    }
    return this;
  }

  optional() {
    if (this._schema.optional) {
      this._schema = this._schema.optional();
    }
    return this;
  }

  /**
   * Configure UI metadata
   * @param {import('./types').UIMeta} options - UI configuration options
   * @returns {SchemaBuilder}
   */
  config(options) {
    if (options.label !== undefined) this._ui.label = options.label;
    if (options.placeholder !== undefined) this._ui.placeholder = options.placeholder;
    if (options.hint !== undefined) this._ui.hint = options.hint;
    if (options.inputType !== undefined) this._ui.inputType = options.inputType;
    if (options.hidden !== undefined) this._ui.hidden = options.hidden;
    if (options.readonly !== undefined) this._ui.readonly = options.readonly;
    if (options.width !== undefined) this._ui.width = options.width;
    if (options.rows !== undefined) this._ui.rows = options.rows;
    if (options.sortable !== undefined) this._ui.sortable = options.sortable;
    return this;
  }

  /**
   * Finalize the schema and return Zod schema with metadata
   * @returns {import('zod').ZodTypeAny}
   */
  _finalize() {
    if (this._finalized) {
      return this._schema;
    }

    // Merge validations and UI into base metadata
    const finalMeta = {
      ...this._baseMeta,
      ...(Object.keys(this._validations).length > 0 && { validations: this._validations }),
      ...(Object.keys(this._ui).length > 0 && { ui: this._ui }),
    };

    // Apply metadata to schema
    this._schema = this._schema.describe(encodeColumnMeta(finalMeta));
    metaWeakMap.set(this._schema, finalMeta);
    this._finalized = true;
    return this._schema;
  }

  /**
   * Proxy unknown methods to underlying Zod schema
   */
  _proxyMethod(name, args) {
    if (typeof this._schema[name] === 'function') {
      this._schema = this._schema[name](...args);
      return this;
    }
    throw new Error(`Method ${name} is not available on this schema type`);
  }
}

// Proxy handler for unknown methods
const handler = {
  get(target, prop) {
    if (prop in target) {
      return target[prop];
    }
    // Proxy unknown methods to Zod schema
    if (typeof target._schema[prop] === 'function') {
      return function(...args) {
        return target._proxyMethod(prop, args);
      };
    }
    return target._schema[prop];
  },
};

/**
 * Create a proxied SchemaBuilder instance
 * @param {import('zod').ZodTypeAny} schema - Base Zod schema
 * @param {import('./types').ColumnMeta} baseMeta - Base column metadata
 * @param {typeof import('zod').z} z - Zod instance
 * @returns {SchemaBuilder}
 */
function createSchemaBuilder(schema, baseMeta, z) {
  return new Proxy(new SchemaBuilder(schema, baseMeta, z), handler);
}

/**
 * Create schema helpers bound to a Zod instance
 * @param {typeof import('zod').z} z - Zod instance
 * @returns {Object} Schema helpers (zdb)
 */
function createSchemaHelpers(z) {
  /**
   * Apply metadata to a Zod schema
   * @param {import('zod').ZodTypeAny} schema - Base Zod schema
   * @param {import('./types').ColumnMeta} meta - Column metadata
   * @returns {import('zod').ZodTypeAny}
   */
  function withMeta(schema, meta) {
    return schema.describe(encodeColumnMeta(meta));
  }

  const helpers = {
    z,
    zod: z,
    /**
     * Create a Zod object schema with database metadata
     * Automatically finalizes SchemaBuilder instances in the shape
     * @param {Object} shape - Object shape with zdb fields (can be SchemaBuilder instances)
     * @returns {import('zod').ZodObject}
     */
    schema(shape) {
      const finalizedShape = {};
      for (const [key, value] of Object.entries(shape)) {
        // If it's a SchemaBuilder, finalize it
        if (value && typeof value._finalize === 'function') {
          finalizedShape[key] = value._finalize();
        } else {
          finalizedShape[key] = value;
        }
      }
      return z.object(finalizedShape);
    },
    /**
     * Primary key column (bigint, auto-increment)
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    id(options = {}) {
      const schema = z.number().int().positive().optional();
      return createSchemaBuilder(schema, {
        type: 'bigint',
        primary: true,
        autoIncrement: true,
        ...options,
      }, z);
    },

    /**
     * UUID primary key column
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    uuid(options = {}) {
      const schema = z.string().uuid().optional();
      return createSchemaBuilder(schema, {
        type: 'uuid',
        primary: true,
        ...options,
      }, z);
    },

    /**
     * Nanoid primary key column (URL-safe string, default length 21)
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    nanoid(options = {}) {
      const { maxLength = 21, ...rest } = options;
      const schema = z
        .string()
        .length(maxLength)
        .regex(/^[A-Za-z0-9_-]+$/)
        .optional();
      return createSchemaBuilder(
        schema,
        {
          type: 'nanoid',
          primary: true,
          maxLength,
          ...rest,
        },
        z
      );
    },

    /**
     * String column (varchar)
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    string(options = {}) {
      const { maxLength = 255, nullable = false, ...rest } = options;
      let schema = z.string().max(maxLength);
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return createSchemaBuilder(schema, {
        type: 'string',
        maxLength,
        nullable,
        ...rest,
      }, z);
    },

    /**
     * Text column (unlimited length)
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    text(options = {}) {
      const { nullable = false, ...rest } = options;
      let schema = z.string();
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return createSchemaBuilder(schema, {
        type: 'text',
        nullable,
        ...rest,
      }, z);
    },

    /**
     * File / URL column (stored as varchar; value is public URL or path from upload)
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    file(options = {}) {
      const { maxLength = 2048, nullable = false, ...rest } = options;
      let schema = z.string().max(maxLength);
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return createSchemaBuilder(schema, {
        type: 'file',
        maxLength,
        nullable,
        ...rest,
      }, z);
    },

    /**
     * Multiple Files / URLs column (stored as JSON array in database)
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    files(options = {}) {
      const { nullable = false, ...rest } = options;
      let schema = z.array(z.string());
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return createSchemaBuilder(schema, {
        type: 'files',
        nullable,
        ...rest,
      }, z);
    },

    /**
     * Integer column
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    integer(options = {}) {
      const { nullable = false, ...rest } = options;
      let schema = z.number().int();
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return createSchemaBuilder(schema, {
        type: 'integer',
        nullable,
        ...rest,
      }, z);
    },

    /**
     * Big integer column
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    bigint(options = {}) {
      const { nullable = false, ...rest } = options;
      let schema = z.number().int();
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return createSchemaBuilder(schema, {
        type: 'bigint',
        nullable,
        ...rest,
      }, z);
    },

    /**
     * Float column
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    float(options = {}) {
      const { nullable = false, ...rest } = options;
      let schema = z.number();
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return createSchemaBuilder(schema, {
        type: 'float',
        nullable,
        ...rest,
      }, z);
    },

    /**
     * Number column (alias for float)
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    number(options = {}) {
      return helpers.float(options);
    },

    /**
     * Email column (alias for string with email validation)
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    email(options = {}) {
      return helpers.string(options).email();
    },

    /**
     * Decimal column
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    decimal(options = {}) {
      const { precision = 10, scale = 2, nullable = false, ...rest } = options;
      let schema = z.number();
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return createSchemaBuilder(schema, {
        type: 'decimal',
        precision,
        scale,
        nullable,
        ...rest,
      }, z);
    },

    /**
     * Boolean column
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    boolean(options = {}) {
      const { nullable = false, default: defaultValue, ...rest } = options;
      // Use preprocess to handle numeric 0/1 from SQLite and string values
      let schema = z.preprocess(
        (val) => {
          if (val === 0 || val === '0' || val === 'false') return false;
          if (val === 1 || val === '1' || val === 'true') return true;
          return val;
        },
        z.boolean()
      );
      if (defaultValue !== undefined) {
        schema = schema.default(defaultValue);
      }
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return createSchemaBuilder(schema, {
        type: 'boolean',
        nullable,
        default: defaultValue,
        ...rest,
      }, z);
    },

    /**
     * Date column (date only, no time)
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    date(options = {}) {
      const { nullable = false, ...rest } = options;
      let schema = z.coerce.date();
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return createSchemaBuilder(schema, {
        type: 'date',
        nullable,
        ...rest,
      }, z);
    },

    /**
     * Datetime column
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    datetime(options = {}) {
      const { nullable = false, ...rest } = options;
      let schema = z.coerce.date();
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return createSchemaBuilder(schema, {
        type: 'datetime',
        nullable,
        ...rest,
      }, z);
    },

    /**
     * Timestamp column (with optional auto behavior)
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    timestamp(options = {}) {
      const { nullable = false, auto, ...rest } = options;
      let schema = z.coerce.date();
      // Auto timestamps are always optional in input
      if (nullable || auto) {
        schema = schema.nullable().optional();
      }
      return createSchemaBuilder(schema, {
        type: 'timestamp',
        nullable: nullable || !!auto,
        auto,
        ...rest,
      }, z);
    },

    /**
     * JSON column
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    json(options = {}) {
      const { nullable = false, ...rest } = options;
      let schema = z.unknown();
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return createSchemaBuilder(schema, {
        type: 'json',
        nullable,
        ...rest,
      }, z);
    },

    /**
     * Array column (stored as JSON in database)
     * @param {import('zod').ZodTypeAny} [itemSchema] - Schema for array items (default: z.any())
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    array(itemSchema, options = {}) {
      // If first argument is options object (backward compatibility)
      if (itemSchema && typeof itemSchema === 'object' && !itemSchema._def) {
        options = itemSchema;
        itemSchema = z.any();
      }
      
      const { nullable = false, ...rest } = options;
      const baseItemSchema = itemSchema || z.any();
      let schema = z.array(baseItemSchema);
      
      if (nullable) {
        schema = schema.nullable().optional();
      }
      
      return createSchemaBuilder(schema, {
        type: 'array',
        nullable,
        ...rest,
      }, z);
    },

    /**
     * Enum column
     * @param {string[]} values - Allowed enum values
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    enum(values, options = {}) {
      const { nullable = false, default: defaultValue, ...rest } = options;
      let schema = z.enum(values);
      if (defaultValue !== undefined) {
        schema = schema.default(defaultValue);
      }
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return createSchemaBuilder(schema, {
        type: 'enum',
        enumValues: values,
        nullable,
        default: defaultValue,
        ...rest,
      }, z);
    },

    /**
     * Foreign key column (references another table)
     * @param {string} references - Referenced table name
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    foreignKey(references, options = {}) {
      const { referenceColumn = 'id', nullable = false, ...rest } = options;
      let schema = z.number().int().positive();
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return createSchemaBuilder(schema, {
        type: 'bigint',
        references,
        referenceColumn,
        nullable,
        ...rest,
      }, z);
    },

    /**
     * UUID foreign key column
     * @param {string} references - Referenced table name
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    foreignUuid(references, options = {}) {
      const { referenceColumn = 'id', nullable = false, ...rest } = options;
      let schema = z.string().uuid();
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return createSchemaBuilder(schema, {
        type: 'uuid',
        references,
        referenceColumn,
        nullable,
        ...rest,
      }, z);
    },

    /**
     * Nanoid foreign key column
     * @param {string} references - Referenced table name
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    foreignNanoid(references, options = {}) {
      const {
        referenceColumn = 'id',
        nullable = false,
        maxLength = 21,
        ...rest
      } = options;
      let schema = z
        .string()
        .length(maxLength)
        .regex(/^[A-Za-z0-9_-]+$/);
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return createSchemaBuilder(schema, {
        type: 'nanoid',
        references,
        referenceColumn,
        nullable,
        maxLength,
        ...rest,
      }, z);
    },

    /**
     * Timestamp pair columns (createdAt and updatedAt)
     * @param {Object} [options={}]
     * @param {boolean} [options.snakeCase=false] - Use snake_case (created_at, updated_at)
     * @param {string} [options.createdAt] - Custom created column name
     * @param {string} [options.updatedAt] - Custom updated column name
     * @returns {{ [key: string]: SchemaBuilder }}
     */
    timestamps(options = {}) {
      const isSnake = options.snakeCase || options.format === 'snake';
      const createdKey = options.createdAt || (isSnake ? 'created_at' : 'createdAt');
      const updatedKey = options.updatedAt || (isSnake ? 'updated_at' : 'updatedAt');

      return {
        [createdKey]: helpers.timestamp({ auto: 'create', ...options }),
        [updatedKey]: helpers.timestamp({ auto: 'update', ...options }),
      };
    },

    /**
     * Soft delete column helper (returns a single SchemaBuilder for deletedAt/deleted_at)
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {SchemaBuilder}
     */
    softDelete(options = {}) {
      return helpers.timestamp({
        nullable: true,
        ...options,
      });
    },

    /**
     * Soft delete field object (returns { deletedAt: SchemaBuilder } or { deleted_at: SchemaBuilder })
     * @param {Object} [options={}]
     * @param {boolean} [options.snakeCase=false] - Use snake_case (deleted_at)
     * @param {string} [options.deletedAt] - Custom deleted column name
     * @returns {{ [key: string]: SchemaBuilder }}
     */
    softDeletes(options = {}) {
      const isSnake = options.snakeCase || options.format === 'snake';
      const deletedKey = options.deletedAt || (isSnake ? 'deleted_at' : 'deletedAt');
      return {
        [deletedKey]: helpers.timestamp({
          nullable: true,
          ...options,
        }),
      };
    },
  };

  return helpers;
}

/**
 * Extract all column metadata from a Zod object schema
 * @param {import('zod').ZodObject} schema - Zod object schema
 * @returns {Map<string, import('./types').ColumnMeta>}
 */
function extractColumnsFromSchema(schema) {
  if (!schema || typeof schema !== 'object' || !schema.shape) {
    return new Map();
  }

  const cached = schemaColumnsWeakMap.get(schema);
  if (cached !== undefined) {
    return cached;
  }

  const columns = new Map();
  const shape = schema.shape;

  for (const [key, fieldSchema] of Object.entries(shape)) {
    let schemaToCheck = fieldSchema;
    
    // Handle SchemaBuilder instances - finalize them first to get metadata
    if (fieldSchema && typeof fieldSchema._finalize === 'function') {
      schemaToCheck = fieldSchema._finalize();
    }
    
    // Also check if it's a SchemaBuilder with _baseMeta (for unfinalized builders)
    if (fieldSchema && fieldSchema._baseMeta) {
      columns.set(key, fieldSchema._baseMeta);
      continue;
    }
    
    // Unwrap optional/nullable wrappers to get to the base schema
    let current = schemaToCheck;
    let isNullable = false;
    while (current && current._def) {
      if (current._def.typeName === 'ZodNullable' || current._def.typeName === 'ZodOptional') {
        isNullable = true;
      }
      if (current._def.innerType) {
        current = current._def.innerType;
      } else if (current._def.schema) {
        current = current._def.schema;
      } else {
        break;
      }
    }

    // Check the schema for metadata
    const meta = getColumnMeta(schemaToCheck) || (current ? getColumnMeta(current) : null);
    if (meta) {
      columns.set(key, meta);
    } else if (current && current._def && current._def.typeName) {
      const typeName = current._def.typeName;
      let inferred = null;
      switch (typeName) {
        case 'ZodString':
          inferred = { type: 'string', maxLength: 255, nullable: isNullable };
          break;
        case 'ZodNumber': {
          const isInt = current._def.checks?.some((c) => c.kind === 'int');
          inferred = { type: isInt ? 'integer' : 'float', nullable: isNullable };
          break;
        }
        case 'ZodBoolean':
          inferred = { type: 'boolean', nullable: isNullable };
          break;
        case 'ZodDate':
          inferred = { type: 'timestamp', nullable: isNullable };
          break;
        case 'ZodEnum':
          inferred = { type: 'enum', enumValues: current._def.values || [], nullable: isNullable };
          break;
        case 'ZodArray':
          inferred = { type: 'files', nullable: isNullable };
          break;
        case 'ZodObject':
        case 'ZodRecord':
          inferred = { type: 'json', nullable: isNullable };
          break;
        default:
          inferred = { type: 'string', nullable: isNullable };
          break;
      }
      if (inferred) {
        columns.set(key, inferred);
      }
    }
  }

  schemaColumnsWeakMap.set(schema, columns);
  return columns;
}

module.exports = {
  createSchemaHelpers,
  encodeColumnMeta,
  decodeColumnMeta,
  hasColumnMeta,
  getColumnMeta,
  extractColumnsFromSchema,
  METADATA_MARKER,
};


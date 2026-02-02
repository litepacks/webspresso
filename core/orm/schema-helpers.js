/**
 * Webspresso ORM - Schema Helpers
 * Wraps Zod with database metadata helpers
 * @module core/orm/schema-helpers
 */

const METADATA_MARKER = '__wdb__';

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
  try {
    const parsed = JSON.parse(description);
    if (parsed && parsed[METADATA_MARKER]) {
      return parsed.meta;
    }
  } catch {
    // Not our metadata, ignore
  }
  return null;
}

/**
 * Check if a Zod schema has ORM column metadata
 * @param {import('zod').ZodTypeAny} schema - Zod schema
 * @returns {boolean}
 */
function hasColumnMeta(schema) {
  return decodeColumnMeta(schema.description) !== null;
}

/**
 * Get column metadata from a Zod schema
 * @param {import('zod').ZodTypeAny} schema - Zod schema
 * @returns {import('./types').ColumnMeta|null}
 */
function getColumnMeta(schema) {
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
      let schema = z.boolean();
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
  };

  return helpers;
}

/**
 * Extract all column metadata from a Zod object schema
 * @param {import('zod').ZodObject} schema - Zod object schema
 * @returns {Map<string, import('./types').ColumnMeta>}
 */
function extractColumnsFromSchema(schema) {
  const columns = new Map();
  const shape = schema.shape;

  for (const [key, fieldSchema] of Object.entries(shape)) {
    // Unwrap optional/nullable wrappers to get to the base schema
    let current = fieldSchema;
    while (current._def) {
      if (current._def.innerType) {
        current = current._def.innerType;
      } else if (current._def.schema) {
        current = current._def.schema;
      } else {
        break;
      }
    }

    // Check the original field schema for metadata
    const meta = getColumnMeta(fieldSchema) || getColumnMeta(current);
    if (meta) {
      columns.set(key, meta);
    }
  }

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


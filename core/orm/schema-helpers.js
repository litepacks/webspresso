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

  return {
    /**
     * Primary key column (bigint, auto-increment)
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {import('zod').ZodNumber}
     */
    id(options = {}) {
      const schema = z.number().int().positive().optional();
      return withMeta(schema, {
        type: 'bigint',
        primary: true,
        autoIncrement: true,
        ...options,
      });
    },

    /**
     * UUID primary key column
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {import('zod').ZodString}
     */
    uuid(options = {}) {
      const schema = z.string().uuid().optional();
      return withMeta(schema, {
        type: 'uuid',
        primary: true,
        ...options,
      });
    },

    /**
     * String column (varchar)
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {import('zod').ZodString}
     */
    string(options = {}) {
      const { maxLength = 255, nullable = false, ...rest } = options;
      let schema = z.string().max(maxLength);
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return withMeta(schema, {
        type: 'string',
        maxLength,
        nullable,
        ...rest,
      });
    },

    /**
     * Text column (unlimited length)
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {import('zod').ZodString}
     */
    text(options = {}) {
      const { nullable = false, ...rest } = options;
      let schema = z.string();
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return withMeta(schema, {
        type: 'text',
        nullable,
        ...rest,
      });
    },

    /**
     * Integer column
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {import('zod').ZodNumber}
     */
    integer(options = {}) {
      const { nullable = false, ...rest } = options;
      let schema = z.number().int();
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return withMeta(schema, {
        type: 'integer',
        nullable,
        ...rest,
      });
    },

    /**
     * Big integer column
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {import('zod').ZodNumber}
     */
    bigint(options = {}) {
      const { nullable = false, ...rest } = options;
      let schema = z.number().int();
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return withMeta(schema, {
        type: 'bigint',
        nullable,
        ...rest,
      });
    },

    /**
     * Float column
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {import('zod').ZodNumber}
     */
    float(options = {}) {
      const { nullable = false, ...rest } = options;
      let schema = z.number();
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return withMeta(schema, {
        type: 'float',
        nullable,
        ...rest,
      });
    },

    /**
     * Decimal column
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {import('zod').ZodNumber}
     */
    decimal(options = {}) {
      const { precision = 10, scale = 2, nullable = false, ...rest } = options;
      let schema = z.number();
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return withMeta(schema, {
        type: 'decimal',
        precision,
        scale,
        nullable,
        ...rest,
      });
    },

    /**
     * Boolean column
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {import('zod').ZodBoolean}
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
      return withMeta(schema, {
        type: 'boolean',
        nullable,
        default: defaultValue,
        ...rest,
      });
    },

    /**
     * Date column (date only, no time)
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {import('zod').ZodDate}
     */
    date(options = {}) {
      const { nullable = false, ...rest } = options;
      let schema = z.coerce.date();
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return withMeta(schema, {
        type: 'date',
        nullable,
        ...rest,
      });
    },

    /**
     * Datetime column
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {import('zod').ZodDate}
     */
    datetime(options = {}) {
      const { nullable = false, ...rest } = options;
      let schema = z.coerce.date();
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return withMeta(schema, {
        type: 'datetime',
        nullable,
        ...rest,
      });
    },

    /**
     * Timestamp column (with optional auto behavior)
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {import('zod').ZodDate}
     */
    timestamp(options = {}) {
      const { nullable = false, auto, ...rest } = options;
      let schema = z.coerce.date();
      // Auto timestamps are always optional in input
      if (nullable || auto) {
        schema = schema.nullable().optional();
      }
      return withMeta(schema, {
        type: 'timestamp',
        nullable: nullable || !!auto,
        auto,
        ...rest,
      });
    },

    /**
     * JSON column
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {import('zod').ZodUnknown}
     */
    json(options = {}) {
      const { nullable = false, ...rest } = options;
      let schema = z.unknown();
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return withMeta(schema, {
        type: 'json',
        nullable,
        ...rest,
      });
    },

    /**
     * Array column (stored as JSON in database)
     * @param {import('zod').ZodTypeAny} [itemSchema] - Schema for array items (default: z.any())
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {import('zod').ZodArray}
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
      
      return withMeta(schema, {
        type: 'array',
        nullable,
        ...rest,
      });
    },

    /**
     * Enum column
     * @param {string[]} values - Allowed enum values
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {import('zod').ZodEnum}
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
      return withMeta(schema, {
        type: 'enum',
        enumValues: values,
        nullable,
        default: defaultValue,
        ...rest,
      });
    },

    /**
     * Foreign key column (references another table)
     * @param {string} references - Referenced table name
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {import('zod').ZodNumber}
     */
    foreignKey(references, options = {}) {
      const { referenceColumn = 'id', nullable = false, ...rest } = options;
      let schema = z.number().int().positive();
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return withMeta(schema, {
        type: 'bigint',
        references,
        referenceColumn,
        nullable,
        ...rest,
      });
    },

    /**
     * UUID foreign key column
     * @param {string} references - Referenced table name
     * @param {Partial<import('./types').ColumnMeta>} [options={}]
     * @returns {import('zod').ZodString}
     */
    foreignUuid(references, options = {}) {
      const { referenceColumn = 'id', nullable = false, ...rest } = options;
      let schema = z.string().uuid();
      if (nullable) {
        schema = schema.nullable().optional();
      }
      return withMeta(schema, {
        type: 'uuid',
        references,
        referenceColumn,
        nullable,
        ...rest,
      });
    },
  };
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


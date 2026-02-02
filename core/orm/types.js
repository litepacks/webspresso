/**
 * Webspresso ORM - Type Definitions
 * JSDoc types for IDE support and documentation
 * @module core/orm/types
 */

// ============================================================================
// Column Metadata Types
// ============================================================================

/**
 * @typedef {'id'|'string'|'text'|'integer'|'bigint'|'float'|'decimal'|'boolean'|'date'|'datetime'|'timestamp'|'json'|'array'|'enum'|'uuid'} ColumnType
 */

/**
 * @typedef {Object} ColumnMeta
 * @property {ColumnType} type - Database column type
 * @property {boolean} [nullable=false] - Whether column allows NULL
 * @property {boolean} [primary=false] - Whether column is primary key
 * @property {boolean} [autoIncrement=false] - Whether column auto-increments
 * @property {boolean} [unique=false] - Whether column has unique constraint
 * @property {boolean} [index=false] - Whether column should be indexed
 * @property {*} [default] - Default value for column
 * @property {number} [maxLength] - Maximum length for string columns
 * @property {number} [precision] - Precision for decimal columns
 * @property {number} [scale] - Scale for decimal columns
 * @property {string[]} [enumValues] - Allowed values for enum columns
 * @property {string} [references] - Referenced table for foreign keys
 * @property {string} [referenceColumn='id'] - Referenced column name
 * @property {'create'|'update'} [auto] - Auto-set on create or update (for timestamps)
 */

/**
 * Encoded column metadata stored in Zod .describe()
 * @typedef {Object} EncodedColumnMeta
 * @property {string} __wdb__ - Marker to identify ORM metadata
 * @property {ColumnMeta} meta - The actual column metadata
 */

// ============================================================================
// Relation Types
// ============================================================================

/**
 * @typedef {'belongsTo'|'hasMany'|'hasOne'} RelationType
 */

/**
 * @typedef {Object} RelationDefinition
 * @property {RelationType} type - Type of relation
 * @property {() => ModelDefinition} model - Lazy reference to related model
 * @property {string} foreignKey - Foreign key column name
 * @property {string} [localKey='id'] - Local key column name (for hasMany/hasOne)
 */

/**
 * @typedef {Object.<string, RelationDefinition>} RelationsMap
 */

// ============================================================================
// Scope Types
// ============================================================================

/**
 * @typedef {Object} ScopeOptions
 * @property {boolean} [softDelete=false] - Enable soft delete (deleted_at column)
 * @property {boolean} [timestamps=false] - Enable auto timestamps (created_at, updated_at)
 * @property {string} [tenant] - Tenant column name for multi-tenancy
 */

/**
 * @typedef {Object} ScopeContext
 * @property {*} [tenantId] - Current tenant ID for multi-tenant queries
 * @property {boolean} [withTrashed=false] - Include soft-deleted records
 * @property {boolean} [onlyTrashed=false] - Only soft-deleted records
 */

// ============================================================================
// Admin Panel Types
// ============================================================================

/**
 * @typedef {Object} CustomFieldConfig
 * @property {string} type - Field renderer type (e.g., 'file-upload', 'rich-text')
 * @property {*} [options] - Additional options for the field renderer
 */

/**
 * @typedef {Function} QueryConfig
 * @param {import('./repository').Repository} repo - Repository instance
 * @returns {Promise<*>} Query result
 */

/**
 * @typedef {Object} AdminMetadata
 * @property {boolean} [enabled=false] - Whether model is enabled in admin panel
 * @property {string} [label] - Display label for the model (default: model name)
 * @property {string} [icon] - Icon for the model (emoji or icon name)
 * @property {Object.<string, CustomFieldConfig>} [customFields={}] - Custom field configurations
 * @property {Object.<string, QueryConfig>} [queries={}] - Custom query functions
 */

// ============================================================================
// Model Types
// ============================================================================

/**
 * @typedef {Object} ModelOptions
 * @property {string} name - Model name (e.g., 'User')
 * @property {string} table - Database table name (e.g., 'users')
 * @property {import('zod').ZodObject} schema - Zod schema for validation
 * @property {string} [primaryKey='id'] - Primary key column name
 * @property {RelationsMap} [relations={}] - Relation definitions
 * @property {ScopeOptions} [scopes={}] - Scope options
 * @property {AdminMetadata} [admin] - Admin panel metadata
 */

/**
 * @typedef {Object} ModelDefinition
 * @property {string} name - Model name
 * @property {string} table - Database table name
 * @property {import('zod').ZodObject} schema - Zod schema
 * @property {string} primaryKey - Primary key column name
 * @property {RelationsMap} relations - Relation definitions
 * @property {ScopeOptions} scopes - Scope options
 * @property {Map<string, ColumnMeta>} columns - Parsed column metadata
 * @property {AdminMetadata} [admin] - Admin panel metadata
 */

// ============================================================================
// Query Builder Types
// ============================================================================

/**
 * @typedef {'='|'!='|'>'|'>='|'<'|'<='|'like'|'ilike'|'in'|'not in'|'is null'|'is not null'} WhereOperator
 */

/**
 * @typedef {Object} WhereClause
 * @property {string} column - Column name
 * @property {WhereOperator} operator - Comparison operator
 * @property {*} value - Value to compare
 * @property {'and'|'or'} [boolean='and'] - Boolean operator for chaining
 */

/**
 * @typedef {Object} OrderByClause
 * @property {string} column - Column name
 * @property {'asc'|'desc'} [direction='asc'] - Sort direction
 */

/**
 * @typedef {Object} QueryState
 * @property {WhereClause[]} wheres - WHERE clauses
 * @property {OrderByClause[]} orderBys - ORDER BY clauses
 * @property {string[]} selects - SELECT columns
 * @property {string[]} withs - Relations to eager load
 * @property {number} [limitValue] - LIMIT value
 * @property {number} [offsetValue] - OFFSET value
 * @property {ScopeContext} scopeContext - Current scope context
 */

// ============================================================================
// Repository Types
// ============================================================================

/**
 * @typedef {Object} FindOptions
 * @property {string[]} [with=[]] - Relations to eager load
 * @property {string[]} [select] - Columns to select
 */

/**
 * @typedef {Object} PaginationOptions
 * @property {number} [page=1] - Page number (1-indexed)
 * @property {number} [perPage=15] - Items per page
 */

/**
 * @typedef {Object} PaginatedResult
 * @property {Object[]} data - Result items
 * @property {number} total - Total count
 * @property {number} page - Current page
 * @property {number} perPage - Items per page
 * @property {number} totalPages - Total pages
 */

// ============================================================================
// Migration Types
// ============================================================================

/**
 * @typedef {Object} MigrationConfig
 * @property {string} [directory='./migrations'] - Migrations directory
 * @property {string} [tableName='knex_migrations'] - Migration tracking table
 */

/**
 * @typedef {Object} MigrationStatus
 * @property {string} name - Migration filename
 * @property {boolean} completed - Whether migration has run
 * @property {Date} [ran_at] - When migration was run
 * @property {number} [batch] - Migration batch number
 */

/**
 * @typedef {Object} MigrationResult
 * @property {number} batch - Batch number
 * @property {string[]} migrations - Migration names run
 */

// ============================================================================
// Database Types
// ============================================================================

/**
 * @typedef {Object} DatabaseConfig
 * @property {string} [models] - Path to models directory (default: './models')
 * @property {string} client - Database client ('pg', 'mysql2', 'better-sqlite3')
 * @property {string|Object} connection - Connection string or config object
 * @property {MigrationConfig} [migrations] - Migration configuration
 * @property {Object} [pool] - Connection pool settings
 */

/**
 * @typedef {Object} DatabaseInstance
 * @property {import('knex').Knex} knex - Knex instance
 * @property {function(ModelDefinition): Repository} createRepository - Create repository for model
 * @property {function(function(TransactionContext): Promise): Promise} transaction - Run in transaction
 * @property {MigrationManager} migrate - Migration manager
 * @property {function(): Promise<void>} destroy - Close all connections
 */

/**
 * @typedef {Object} TransactionContext
 * @property {import('knex').Knex.Transaction} trx - Knex transaction
 * @property {function(ModelDefinition): Repository} createRepository - Create repository in transaction
 */

/**
 * @typedef {Object} Repository
 * @property {function(number|string, FindOptions=): Promise<Object|null>} findById - Find by primary key
 * @property {function(Object, FindOptions=): Promise<Object|null>} findOne - Find single record
 * @property {function(FindOptions=): Promise<Object[]>} findAll - Find all records
 * @property {function(Object): Promise<Object>} create - Create new record
 * @property {function(number|string, Object): Promise<Object|null>} update - Update record
 * @property {function(number|string): Promise<boolean>} delete - Delete record (soft if enabled)
 * @property {function(number|string): Promise<boolean>} forceDelete - Hard delete record
 * @property {function(): QueryBuilder} query - Get query builder
 */

/**
 * @typedef {Object} MigrationManager
 * @property {function(): Promise<MigrationResult>} latest - Run pending migrations
 * @property {function(Object=): Promise<MigrationResult>} rollback - Rollback migrations
 * @property {function(): Promise<MigrationStatus[]>} status - Get migration status
 * @property {function(string, Object=): Promise<string>} make - Create new migration file
 */

// ============================================================================
// Exports (for type resolution)
// ============================================================================

module.exports = {};


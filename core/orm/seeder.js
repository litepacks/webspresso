/**
 * Auto Seeder
 * Generate fake data based on Zod schema metadata
 * Uses @faker-js/faker for data generation
 */

const { getModel, getAllModels } = require('./model');
const { generateNanoid } = require('./utils/nanoid');

/**
 * @typedef {Object} SeederOptions
 * @property {number} [count=10] - Number of records to create
 * @property {Object} [overrides={}] - Override specific fields
 * @property {Object} [with={}] - Create related records { posts: 3 }
 * @property {Object} [generators={}] - Custom generators per field
 */

/**
 * @typedef {Object} FactoryDefinition
 * @property {Object} model - Model definition
 * @property {Object} [defaults={}] - Default overrides
 * @property {Object} [generators={}] - Custom field generators
 * @property {Object} [states={}] - Named state modifiers
 */

/**
 * Create a seeder instance
 * @param {Object} faker - Faker instance (@faker-js/faker)
 * @param {Object} knex - Knex instance
 * @returns {Object} Seeder API
 */
function createSeeder(faker, knex) {
  if (!faker) {
    throw new Error('Faker instance is required. Install @faker-js/faker and pass it to createSeeder.');
  }

  /** @type {Map<string, FactoryDefinition>} */
  const factories = new Map();

  /**
   * Generate fake value based on column metadata
   * @param {string} columnName - Column name
   * @param {Object} meta - Column metadata
   * @returns {*} Generated value
   */
  function generateValue(columnName, meta) {
    // Skip auto-generated fields
    if (meta.autoIncrement || meta.auto === 'create' || meta.auto === 'update') {
      return undefined;
    }

    // Handle nullable with 10% chance of null
    if (meta.nullable && faker.datatype.boolean({ probability: 0.1 })) {
      return null;
    }

    // Use default if defined (50% chance)
    if (meta.default !== undefined && faker.datatype.boolean({ probability: 0.5 })) {
      return meta.default;
    }

    // Smart field detection by name
    const lowerName = columnName.toLowerCase();

    // Array type should be handled in generateByType (skip smart detection for arrays)
    if (meta.type === 'array') {
      return generateByType(columnName, meta);
    }

    // Email detection
    if (lowerName.includes('email')) {
      return faker.internet.email().toLowerCase();
    }

    // Name detection
    if (lowerName === 'name' || lowerName === 'full_name' || lowerName === 'fullname') {
      return faker.person.fullName();
    }
    if (lowerName === 'first_name' || lowerName === 'firstname') {
      return faker.person.firstName();
    }
    if (lowerName === 'last_name' || lowerName === 'lastname') {
      return faker.person.lastName();
    }
    if (lowerName === 'username' || lowerName === 'user_name') {
      return faker.internet.username().toLowerCase();
    }

    // Title/Slug detection
    if (lowerName === 'title') {
      return faker.lorem.sentence({ min: 3, max: 8 }).slice(0, -1);
    }
    if (lowerName === 'slug') {
      return faker.lorem.slug({ min: 2, max: 4 });
    }

    // Content detection
    if (lowerName === 'content' || lowerName === 'body' || lowerName === 'description') {
      return faker.lorem.paragraphs({ min: 1, max: 3 });
    }
    if (lowerName === 'bio' || lowerName === 'about') {
      return faker.lorem.paragraph();
    }
    if (lowerName === 'summary' || lowerName === 'excerpt') {
      return faker.lorem.sentence();
    }

    // URL detection
    if (lowerName.includes('url') || lowerName.includes('link')) {
      return faker.internet.url();
    }
    if (lowerName === 'avatar' || lowerName === 'image' || lowerName === 'photo') {
      return faker.image.avatar();
    }

    // Phone detection
    if (lowerName.includes('phone') || lowerName.includes('tel')) {
      return faker.phone.number();
    }

    // Address detection
    if (lowerName === 'address' || lowerName === 'street') {
      return faker.location.streetAddress();
    }
    if (lowerName === 'city') {
      return faker.location.city();
    }
    if (lowerName === 'country') {
      return faker.location.country();
    }
    if (lowerName === 'zip' || lowerName === 'zipcode' || lowerName === 'postal_code') {
      return faker.location.zipCode();
    }

    // Company detection
    if (lowerName === 'company' || lowerName === 'company_name') {
      return faker.company.name();
    }

    // Price/Amount detection
    if (lowerName.includes('price') || lowerName.includes('amount') || lowerName.includes('cost')) {
      return parseFloat(faker.commerce.price({ min: 10, max: 1000 }));
    }

    // Count/Quantity detection
    if (lowerName.includes('count') || lowerName.includes('quantity') || lowerName.includes('qty')) {
      return faker.number.int({ min: 1, max: 100 });
    }

    // Status detection
    if (lowerName === 'status') {
      return faker.helpers.arrayElement(['active', 'inactive', 'pending']);
    }

    // Generate by type (pass columnName for array type detection)
    return generateByType(columnName, meta);
  }

  /**
   * Generate value by column type
   * @param {string} columnName - Column name (for smart detection, especially for arrays)
   * @param {Object} meta - Column metadata
   * @returns {*} Generated value
   */
  function generateByType(columnName, meta) {
    switch (meta.type) {
      case 'bigint':
      case 'integer':
        return faker.number.int({ min: 1, max: 10000 });

      case 'float':
        return faker.number.float({ min: 0, max: 1000, fractionDigits: 2 });

      case 'decimal':
        const precision = meta.precision || 10;
        const scale = meta.scale || 2;
        const max = Math.pow(10, precision - scale) - 1;
        return parseFloat(faker.number.float({ min: 0, max, fractionDigits: scale }).toFixed(scale));

      case 'boolean':
        return faker.datatype.boolean();

      case 'date':
        return faker.date.past().toISOString().split('T')[0];

      case 'datetime':
      case 'timestamp':
        return faker.date.past().toISOString();

      case 'uuid':
        return faker.string.uuid();

      case 'nanoid':
        return generateNanoid(meta.maxLength || 21);

      case 'json':
        return { key: faker.lorem.word(), value: faker.lorem.sentence() };

      case 'array':
        // Generate a random array with 1-5 items
        const arrayLength = faker.number.int({ min: 1, max: 5 });
        const arrayItems = [];
        
        // Try to infer item type from column name
        const lowerName = (columnName || '').toLowerCase();
        
        // String arrays (tags, categories, etc.)
        if (lowerName.includes('tag') || lowerName.includes('category') || 
            lowerName.includes('label') || lowerName.includes('keyword')) {
          for (let i = 0; i < arrayLength; i++) {
            arrayItems.push(faker.lorem.word());
          }
        }
        // Number arrays (ids, scores, etc.)
        else if (lowerName.includes('id') || lowerName.includes('score') || 
                 lowerName.includes('price') || lowerName.includes('amount')) {
          for (let i = 0; i < arrayLength; i++) {
            arrayItems.push(faker.number.int({ min: 1, max: 100 }));
          }
        }
        // Email arrays
        else if (lowerName.includes('email')) {
          for (let i = 0; i < arrayLength; i++) {
            arrayItems.push(faker.internet.email().toLowerCase());
          }
        }
        // URL arrays
        else if (lowerName.includes('url') || lowerName.includes('link')) {
          for (let i = 0; i < arrayLength; i++) {
            arrayItems.push(faker.internet.url());
          }
        }
        // Default: mixed array (strings and numbers)
        else {
          for (let i = 0; i < arrayLength; i++) {
            if (faker.datatype.boolean()) {
              arrayItems.push(faker.lorem.word());
            } else {
              arrayItems.push(faker.number.int({ min: 1, max: 100 }));
            }
          }
        }
        
        return arrayItems;

      case 'enum':
        if (meta.enumValues && meta.enumValues.length > 0) {
          return faker.helpers.arrayElement(meta.enumValues);
        }
        return null;

      case 'text':
        return faker.lorem.paragraphs({ min: 1, max: 3 });

      case 'string':
      default:
        const maxLength = meta.maxLength || 255;
        const text = faker.lorem.sentence();
        return text.length > maxLength ? text.substring(0, maxLength) : text;
    }
  }

  /**
   * Generate a single record for a model
   * @param {Object} model - Model definition
   * @param {Object} overrides - Field overrides
   * @param {Object} generators - Custom generators
   * @returns {Object} Generated record
   */
  function generateRecord(model, overrides = {}, generators = {}) {
    const record = {};

    if (!model.columns) {
      throw new Error(`Model "${model.name}" has no columns defined`);
    }

    for (const [columnName, meta] of model.columns) {
      // Skip if overridden
      if (columnName in overrides) {
        record[columnName] = overrides[columnName];
        continue;
      }

      // Use custom generator if provided
      if (columnName in generators) {
        const generator = generators[columnName];
        record[columnName] = typeof generator === 'function' ? generator(faker) : generator;
        continue;
      }

      // Skip foreign keys (will be handled by relations)
      if (meta.references) {
        continue;
      }

      // Generate value
      const value = generateValue(columnName, meta);
      if (value !== undefined) {
        record[columnName] = value;
      }
    }

    return record;
  }

  /**
   * Define a factory for a model
   * @param {string|Object} modelOrName - Model or model name
   * @param {Object} options - Factory options
   * @returns {Object} Factory builder
   */
  function defineFactory(modelOrName, options = {}) {
    const model = typeof modelOrName === 'string' ? getModel(modelOrName) : modelOrName;
    
    if (!model) {
      throw new Error(`Model not found: ${modelOrName}`);
    }

    const factory = {
      model,
      defaults: options.defaults || {},
      generators: options.generators || {},
      states: options.states || {},
    };

    factories.set(model.name, factory);

    // Start with depth 0 and empty visited set
    return createFactoryBuilder(factory, 0, new Set());
  }

  /**
   * Get factory for a model
   * @param {string|Object} modelOrName - Model or model name
   * @returns {Object} Factory builder
   */
  function factory(modelOrName) {
    const modelName = typeof modelOrName === 'string' ? modelOrName : modelOrName.name;
    
    let factoryDef = factories.get(modelName);
    
    // Auto-create factory if not defined
    if (!factoryDef) {
      const model = typeof modelOrName === 'string' ? getModel(modelOrName) : modelOrName;
      if (!model) {
        throw new Error(`Model not found: ${modelName}`);
      }
      factoryDef = { model, defaults: {}, generators: {}, states: {} };
      factories.set(modelName, factoryDef);
    }

    // Start with depth 0 and empty visited set
    return createFactoryBuilder(factoryDef, 0, new Set());
  }

  /**
   * Create factory builder with fluent API
   * @param {FactoryDefinition} factoryDef - Factory definition
   * @returns {Object} Factory builder
   */
  function createFactoryBuilder(factoryDef, depth = 0, visited = new Set()) {
    let currentOverrides = { ...factoryDef.defaults };
    let currentGenerators = { ...factoryDef.generators };
    let currentRelations = {};
    let activeStates = [];

    // Maximum depth to prevent infinite recursion
    const MAX_DEPTH = 5;
    const modelKey = factoryDef.model.name || factoryDef.model.table;

    const builder = {
      /**
       * Apply a named state
       * @param {string} stateName - State name
       * @returns {Object} Builder
       */
      state(stateName) {
        if (factoryDef.states[stateName]) {
          activeStates.push(stateName);
          const stateConfig = factoryDef.states[stateName];
          if (typeof stateConfig === 'function') {
            const stateOverrides = stateConfig(faker);
            currentOverrides = { ...currentOverrides, ...stateOverrides };
          } else {
            currentOverrides = { ...currentOverrides, ...stateConfig };
          }
        }
        return builder;
      },

      /**
       * Override specific fields
       * @param {Object} overrides - Field overrides
       * @returns {Object} Builder
       */
      override(overrides) {
        currentOverrides = { ...currentOverrides, ...overrides };
        return builder;
      },

      /**
       * Add custom generators
       * @param {Object} generators - Custom generators
       * @returns {Object} Builder
       */
      generators(generators) {
        currentGenerators = { ...currentGenerators, ...generators };
        return builder;
      },

      /**
       * Create related records
       * @param {string} relationName - Relation name
       * @param {number} [count=1] - Number of related records
       * @returns {Object} Builder
       */
      with(relationName, count = 1) {
        currentRelations[relationName] = count;
        return builder;
      },

      /**
       * Generate record(s) without saving
       * @param {number} [count=1] - Number of records
       * @returns {Object|Object[]} Generated record(s)
       */
      make(count = 1) {
        const records = [];
        for (let i = 0; i < count; i++) {
          records.push(generateRecord(factoryDef.model, currentOverrides, currentGenerators));
        }
        return count === 1 ? records[0] : records;
      },

      /**
       * Create and save record(s)
       * @param {number} [count=1] - Number of records
       * @returns {Promise<Object|Object[]>} Created record(s)
       */
      async create(count = 1) {
        const records = [];
        const model = factoryDef.model;

        for (let i = 0; i < count; i++) {
          const record = generateRecord(model, currentOverrides, currentGenerators);

          // Handle belongsTo relations first (need parent IDs)
          // Only create parents if not in a circular dependency and depth is acceptable
          if (model.relations && !visited.has(modelKey) && depth < MAX_DEPTH) {
            // Create a new visited set for this record to track circular dependencies
            const recordVisited = new Set(visited);
            recordVisited.add(modelKey);
            
            for (const [relName, relation] of Object.entries(model.relations)) {
              if (relation.type === 'belongsTo' && relation.foreignKey) {
                // Check if foreign key is already set
                if (record[relation.foreignKey]) continue;

                // Check if we should create related or skip
                const relatedModel = relation.model();
                if (relatedModel) {
                  const relatedModelName = relatedModel.name || relatedModel.table;
                  
                  // Check for circular dependency
                  if (recordVisited.has(relatedModelName)) {
                    console.warn(`⚠️  Circular dependency detected: "${modelKey}" -> "${relatedModelName}". Skipping automatic parent creation.`);
                    continue;
                  }
                  
                  try {
                    // Get or create factory for related model
                    let relatedFactoryDef = factories.get(relatedModelName);
                    if (!relatedFactoryDef) {
                      relatedFactoryDef = { model: relatedModel, defaults: {}, generators: {}, states: {} };
                      factories.set(relatedModelName, relatedFactoryDef);
                    }
                    
                    // Create builder with increased depth and updated visited set
                    const parentBuilder = createFactoryBuilder(relatedFactoryDef, depth + 1, recordVisited);
                    const parent = await parentBuilder.create();
                    record[relation.foreignKey] = parent[relatedModel.primaryKey || 'id'];
                  } catch (err) {
                    // If creating parent fails (e.g., circular dependency), skip it
                    console.warn(`⚠️  Failed to create parent for "${modelKey}.${relName}": ${err.message}`);
                  }
                }
              }
            }
          } else if (visited.has(modelKey)) {
            console.warn(`⚠️  Circular dependency detected for model "${modelKey}". Skipping automatic parent creation.`);
          } else if (depth >= MAX_DEPTH) {
            console.warn(`⚠️  Maximum depth (${MAX_DEPTH}) reached for model "${modelKey}". Skipping automatic parent creation.`);
          }

          // Insert record
          const [insertedId] = await knex(model.table).insert(record);
          const primaryKey = model.primaryKey || 'id';
          const id = record[primaryKey] || insertedId;

          // Fetch the created record
          const created = await knex(model.table).where(primaryKey, id).first();
          
          // Handle hasMany relations
          if (model.relations && depth < MAX_DEPTH) {
            // Create a new visited set for this record
            const recordVisited = new Set(visited);
            recordVisited.add(modelKey);
            
            for (const [relName, count] of Object.entries(currentRelations)) {
              const relation = model.relations[relName];
              if (relation && relation.type === 'hasMany') {
                const relatedModel = relation.model();
                if (relatedModel) {
                  const relatedModelName = relatedModel.name || relatedModel.table;
                  
                  // Check for circular dependency
                  if (recordVisited.has(relatedModelName)) {
                    console.warn(`⚠️  Circular dependency detected: "${modelKey}" -> "${relatedModelName}". Skipping automatic children creation.`);
                    continue;
                  }
                  
                  try {
                    // Get or create factory for related model
                    let relatedFactoryDef = factories.get(relatedModelName);
                    if (!relatedFactoryDef) {
                      relatedFactoryDef = { model: relatedModel, defaults: {}, generators: {}, states: {} };
                      factories.set(relatedModelName, relatedFactoryDef);
                    }
                    
                    // Create builder with increased depth and updated visited set
                    const childrenBuilder = createFactoryBuilder(relatedFactoryDef, depth + 1, recordVisited);
                    const children = await childrenBuilder
                      .override({ [relation.foreignKey]: created[primaryKey] })
                      .create(count);
                    created[relName] = Array.isArray(children) ? children : [children];
                  } catch (err) {
                    console.warn(`⚠️  Failed to create children for "${modelKey}.${relName}": ${err.message}`);
                  }
                }
              }
            }
          }

          records.push(created);
        }

        return count === 1 ? records[0] : records;
      },

      /**
       * Create records in a transaction
       * @param {number} [count=1] - Number of records
       * @returns {Promise<Object|Object[]>} Created record(s)
       */
      async createInTransaction(count = 1) {
        return knex.transaction(async (trx) => {
          const originalKnex = knex;
          // Temporarily replace knex with transaction
          const records = [];
          const model = factoryDef.model;

          for (let i = 0; i < count; i++) {
            const record = generateRecord(model, currentOverrides, currentGenerators);

            // Handle belongsTo relations
            if (model.relations) {
              for (const [relName, relation] of Object.entries(model.relations)) {
                if (relation.type === 'belongsTo' && relation.foreignKey) {
                  if (record[relation.foreignKey]) continue;
                  const relatedModel = relation.model();
                  if (relatedModel) {
                    const parentRecord = generateRecord(relatedModel, {}, {});
                    const [parentId] = await trx(relatedModel.table).insert(parentRecord);
                    record[relation.foreignKey] = parentRecord[relatedModel.primaryKey || 'id'] || parentId;
                  }
                }
              }
            }

            const [insertedId] = await trx(model.table).insert(record);
            const primaryKey = model.primaryKey || 'id';
            const id = record[primaryKey] || insertedId;
            const created = await trx(model.table).where(primaryKey, id).first();
            records.push(created);
          }

          return count === 1 ? records[0] : records;
        });
      },
    };

    return builder;
  }

  /**
   * Seed a model with records
   * @param {string|Object} modelOrName - Model or model name
   * @param {number} count - Number of records
   * @param {Object} [options={}] - Seed options
   * @returns {Promise<Object[]>} Created records
   */
  async function seed(modelOrName, count, options = {}) {
    const builder = factory(modelOrName);
    
    if (options.overrides) {
      builder.override(options.overrides);
    }
    
    if (options.generators) {
      builder.generators(options.generators);
    }
    
    if (options.state) {
      builder.state(options.state);
    }

    const records = await builder.create(count);
    return Array.isArray(records) ? records : [records];
  }

  /**
   * Run multiple seeders
   * @param {Object[]} seeders - Array of seeder configs
   * @returns {Promise<Object>} Results by model name
   */
  async function run(seeders) {
    const results = {};

    for (const seederConfig of seeders) {
      const { model, count = 10, ...options } = seederConfig;
      const modelName = typeof model === 'string' ? model : model.name;
      results[modelName] = await seed(model, count, options);
    }

    return results;
  }

  /**
   * Truncate table(s)
   * @param {string|string[]|Object|Object[]} models - Model(s) to truncate
   * @returns {Promise<void>}
   */
  async function truncate(models) {
    const modelList = Array.isArray(models) ? models : [models];
    
    for (const modelOrName of modelList) {
      const model = typeof modelOrName === 'string' ? getModel(modelOrName) : modelOrName;
      if (model) {
        await knex(model.table).truncate();
      }
    }
  }

  /**
   * Clear all tables (respecting foreign key order)
   * @returns {Promise<void>}
   */
  async function clearAll() {
    const allModels = getAllModels();
    const tables = [];
    
    // Collect tables with dependency info
    for (const [name, model] of allModels) {
      const deps = [];
      if (model.relations) {
        for (const relation of Object.values(model.relations)) {
          if (relation.type === 'belongsTo') {
            const relatedModel = relation.model();
            if (relatedModel) {
              deps.push(relatedModel.table);
            }
          }
        }
      }
      tables.push({ table: model.table, deps });
    }

    // Sort by dependencies (tables with no deps first)
    tables.sort((a, b) => a.deps.length - b.deps.length);

    // Reverse to delete children first
    for (const { table } of tables.reverse()) {
      try {
        await knex(table).del();
      } catch (e) {
        // Ignore errors (table might not exist)
      }
    }
  }

  return {
    defineFactory,
    factory,
    seed,
    run,
    truncate,
    clearAll,
    // Expose faker for custom generators
    faker,
  };
}

module.exports = { createSeeder };


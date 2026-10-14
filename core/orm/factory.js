/**
 * Webspresso ORM - Model Factory & Seeding (AdonisJS Lucid-inspired)
 * Declarative mock data generation and seeding for tests and development
 * @module core/orm/factory
 */

/**
 * Fallback lightweight mock faker when @faker-js/faker is not present
 */
function createMinimalFaker() {
  let counter = 1000;
  return {
    person: {
      fullName: () => `User_${++counter}`,
      firstName: () => `First_${++counter}`,
      lastName: () => `Last_${++counter}`,
    },
    internet: {
      email: () => `user_${++counter}@example.com`,
      userName: () => `user_${++counter}`,
      url: () => `https://example.com/item/${++counter}`,
    },
    lorem: {
      sentence: (words = 5) => `Sample text description ${++counter}`,
      paragraph: () => `Sample paragraph for model testing with counter ${++counter}.`,
      words: (n = 3) => `words_${++counter}`,
    },
    number: {
      int: (opts = { min: 1, max: 1000 }) => {
        const min = opts.min ?? 1;
        const max = opts.max ?? 1000;
        return Math.floor(Math.random() * (max - min + 1)) + min;
      },
      float: (opts = { min: 1, max: 100, precision: 0.01 }) => {
        const min = opts.min ?? 1;
        const max = opts.max ?? 100;
        return Number((Math.random() * (max - min) + min).toFixed(2));
      },
    },
    date: {
      recent: () => new Date(),
      past: () => new Date(Date.now() - 86400000 * 30),
      future: () => new Date(Date.now() + 86400000 * 30),
    },
    datatype: {
      boolean: () => Math.random() > 0.5,
    },
    string: {
      nanoid: () => `nano_${Math.random().toString(36).slice(2, 10)}`,
      uuid: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    },
  };
}

function resolveFaker() {
  try {
    const fakerMod = require('@faker-js/faker');
    return fakerMod.faker || fakerMod.default?.faker || fakerMod;
  } catch {
    return createMinimalFaker();
  }
}

/**
 * Factory Builder for generating single or multiple model instances
 */
class FactoryBuilder {
  /**
   * @param {string} modelName
   * @param {Function} definitionFn
   * @param {Map<string, Function|Object>} states
   */
  constructor(modelName, definitionFn, states = new Map()) {
    this._modelName = modelName;
    this._definitionFn = definitionFn;
    this._states = states;
    this._appliedStates = [];
    this._count = 1;
    this._overrides = {};
  }

  /**
   * Set number of records to generate
   * @param {number} n
   * @returns {FactoryBuilder}
   */
  count(n) {
    const clone = this._clone();
    clone._count = Math.max(1, Math.floor(n));
    return clone;
  }

  /**
   * Apply one or more named states
   * @param {...string} stateNames
   * @returns {FactoryBuilder}
   */
  state(...stateNames) {
    return this.apply(...stateNames);
  }

  /**
   * Apply one or more named states
   * @param {...string} stateNames
   * @returns {FactoryBuilder}
   */
  apply(...stateNames) {
    const clone = this._clone();
    clone._appliedStates.push(...stateNames);
    return clone;
  }

  /**
   * Merge field overrides
   * @param {Object} overrides
   * @returns {FactoryBuilder}
   */
  merge(overrides = {}) {
    const clone = this._clone();
    clone._overrides = { ...clone._overrides, ...overrides };
    return clone;
  }

  /**
   * Build single raw record object without persisting
   * @param {number} index
   * @param {Object} [additionalOverrides={}]
   * @returns {Object}
   */
  _buildOne(index = 0, additionalOverrides = {}) {
    const faker = resolveFaker();
    let data = this._definitionFn({ faker, index }) || {};

    for (const stateName of this._appliedStates) {
      const stateHandler = this._states.get(stateName);
      if (stateHandler) {
        const stateData =
          typeof stateHandler === 'function'
            ? stateHandler({ faker, index, current: data })
            : stateHandler;
        data = { ...data, ...stateData };
      }
    }

    return { ...data, ...this._overrides, ...additionalOverrides };
  }

  /**
   * Generate raw data objects in memory (does not insert into DB)
   * @param {Object} [overrides={}]
   * @returns {Object|Object[]}
   */
  make(overrides = {}) {
    if (this._count === 1) {
      return this._buildOne(0, overrides);
    }
    return Array.from({ length: this._count }, (_, i) => this._buildOne(i, overrides));
  }

  /**
   * Generate and persist record(s) to the database using repository
   * @param {Object} options
   * @param {import('./types').DatabaseInstance|import('./types').Repository} options.db - Database or repository
   * @param {Object} [options.merge={}] - Additional field overrides
   * @returns {Promise<Object|Object[]>}
   */
  async create(options = {}) {
    const target = options.db || options;
    let repo;

    if (target && typeof target.getRepository === 'function') {
      repo = target.getRepository(this._modelName);
    } else if (target && typeof target.create === 'function') {
      repo = target;
    } else {
      throw new Error(
        `Factory.create() requires a database instance: .create({ db }) for model "${this._modelName}"`
      );
    }

    const mergeData = options.merge || {};

    if (this._count === 1) {
      const attributes = this._buildOne(0, mergeData);
      return await repo.create(attributes);
    }

    const items = Array.from({ length: this._count }, (_, i) => this._buildOne(i, mergeData));
    const results = [];
    for (const item of items) {
      results.push(await repo.create(item));
    }
    return results;
  }

  /**
   * Clone builder preserving definition and state
   * @protected
   */
  _clone() {
    const clone = new FactoryBuilder(this._modelName, this._definitionFn, this._states);
    clone._appliedStates = [...this._appliedStates];
    clone._count = this._count;
    clone._overrides = { ...this._overrides };
    return clone;
  }
}

/**
 * Define a model factory (AdonisJS Lucid-inspired)
 * @param {string} modelName - Model identifier in registry (e.g. 'User')
 * @param {Function} definitionFn - Factory blueprint `({ faker, index }) => ({ ... })`
 * @returns {FactoryBuilder & { state: (name: string, handler: Function|Object) => any }}
 */
function defineFactory(modelName, definitionFn) {
  if (typeof modelName !== 'string' || !modelName.trim()) {
    throw new Error('defineFactory expects a model name string as first argument');
  }
  if (typeof definitionFn !== 'function') {
    throw new Error(`defineFactory expects a definition function for model "${modelName}"`);
  }

  const states = new Map();
  const rootBuilder = new FactoryBuilder(modelName, definitionFn, states);

  // Extend root builder with fluent state registration
  rootBuilder.registerState = function (name, handler) {
    states.set(name, handler);
    return rootBuilder;
  };

  // Allow .state('admin', fn) as registration when called with 2 args,
  // or as apply when called with 1 arg.
  const originalState = rootBuilder.state.bind(rootBuilder);
  rootBuilder.state = function (nameOrFirst, maybeHandler, ...rest) {
    if (typeof maybeHandler === 'function' || (maybeHandler && typeof maybeHandler === 'object')) {
      states.set(nameOrFirst, maybeHandler);
      return rootBuilder;
    }
    return originalState(nameOrFirst, ...rest);
  };

  return rootBuilder;
}

module.exports = {
  defineFactory,
  FactoryBuilder,
  resolveFaker,
};

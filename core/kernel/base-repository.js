const { randomUUID } = require('./events');

/**
 * @typedef {ReturnType<import('./events').createEventBus>} EventBus
 */

/**
 * Simulated in-memory row store keyed by id (UUID).
 */
class MemoryStore {
  constructor() {
    /** @type {Array<{ id: string } & Record<string, any>>} */
    this._rows = [];
  }

  insert(record) {
    this._rows.push(record);
    return record;
  }

  findIndex(id) {
    return this._rows.findIndex((r) => r.id === id);
  }

  getAt(index) {
    return this._rows[index];
  }

  /**
   * @param {number} index
   * @param {{ id: string } & Record<string, any>} row
   */
  setAt(index, row) {
    this._rows[index] = row;
  }

  deleteAt(index) {
    const [removed] = this._rows.splice(index, 1);
    return removed;
  }
}

/**
 * @template T
 */
class BaseRepository {
  /**
   * @param {EventBus} events
   * @param {{ resource: string, source?: import('./events').EventSource }} options
   */
  constructor(events, options) {
    this.events = events;
    this.resource = options.resource;
    this.source = options.source || 'orm';
    this._store = new MemoryStore();
  }

  /** @param {string} phase */
  _eventName(phase) {
    return `orm.${this.resource}.${phase}`;
  }

  /**
   * @param {T & { id?: string }} data
   */
  async create(data) {
    const id = data.id || randomUUID();
    const record = { ...data, id };

    const beforeCtx = this.events.buildContext(
      { data: { ...record } },
      { source: this.source },
    );
    await this.events.dispatch(this._eventName('beforeCreate'), beforeCtx);

    const toInsert = beforeCtx.payload.data;
    const saved = this._store.insert({ ...toInsert });

    const afterCtx = this.events.buildContext(
      { record: saved },
      { source: this.source },
    );
    await this.events.publish(this._eventName('afterCreate'), afterCtx);

    return saved;
  }

  /**
   * @param {string} id
   * @param {Partial<T>} data
   */
  async update(id, data) {
    const idx = this._store.findIndex(id);
    if (idx === -1) {
      throw new Error(`Record not found: ${id}`);
    }
    const existing = this._store.getAt(idx);

    const beforeCtx = this.events.buildContext(
      { id, data, record: { ...existing } },
      { source: this.source },
    );
    await this.events.dispatch(this._eventName('beforeUpdate'), beforeCtx);

    const merged = { ...existing, ...beforeCtx.payload.data, id };
    this._store.setAt(idx, merged);

    const afterCtx = this.events.buildContext(
      { record: merged, previous: existing },
      { source: this.source },
    );
    await this.events.publish(this._eventName('afterUpdate'), afterCtx);

    return merged;
  }

  /**
   * @param {string} id
   */
  async delete(id) {
    const idx = this._store.findIndex(id);
    if (idx === -1) {
      throw new Error(`Record not found: ${id}`);
    }
    const existing = this._store.getAt(idx);

    const beforeCtx = this.events.buildContext(
      { id, record: { ...existing } },
      { source: this.source },
    );
    await this.events.dispatch(this._eventName('beforeDelete'), beforeCtx);

    const removed = this._store.deleteAt(idx);

    const afterCtx = this.events.buildContext(
      { id, record: removed },
      { source: this.source },
    );
    await this.events.publish(this._eventName('afterDelete'), afterCtx);
  }
}

module.exports = { BaseRepository, MemoryStore };

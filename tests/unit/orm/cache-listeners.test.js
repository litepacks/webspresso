/**
 * Unit tests for ORM Cache Model Event Listeners
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  registerOrmCacheListeners,
  unregisterOrmCacheListeners,
  _resetForTesting,
} from '../../../core/orm/cache/listeners';

const { ModelEvents, Hooks } = require('../../../core/orm/events');
const modelMod = require('../../../core/orm/model');

describe('ORM Cache Model Event Listeners', () => {
  let mockLayer;
  let mockModel;
  let getModelSpy;

  beforeEach(() => {
    _resetForTesting();

    mockModel = {
      name: 'Article',
      table: 'articles',
      cache: true,
    };

    mockLayer = {
      strategyFor: vi.fn().mockReturnValue({ mode: 'smart' }),
      tagsForMutation: vi.fn().mockReturnValue(['tbl:articles', 'model:Article']),
      scheduleInvalidate: vi.fn(),
    };

    getModelSpy = vi.spyOn(modelMod, 'getModel').mockImplementation((name) => {
      if (name === 'Article') return mockModel;
      return null;
    });

    if (modelMod._registry) {
      modelMod._registry.set('Article', mockModel);
    }
  });

  afterEach(() => {
    _resetForTesting();
    getModelSpy.mockRestore();
    if (modelMod._registry) {
      modelMod._registry.delete('Article');
    }
  });

  it('registers listeners and schedules invalidation on after_create event', async () => {
    registerOrmCacheListeners(mockLayer);

    const record = { id: 101, title: 'Hello World' };
    const ctx = { model: 'Article', trx: { id: 'trx_1' } };

    ModelEvents.emit('Article', Hooks.AFTER_CREATE, record, ctx);

    expect(mockLayer.strategyFor).toHaveBeenCalledWith(mockModel);
    expect(mockLayer.tagsForMutation).toHaveBeenCalledWith(mockModel, { mode: 'smart' }, 'create', record);
    expect(mockLayer.scheduleInvalidate).toHaveBeenCalledWith(ctx.trx, ['tbl:articles', 'model:Article']);
  });

  it('schedules invalidation on after_update, after_delete, and after_restore events', async () => {
    registerOrmCacheListeners(mockLayer);

    const record = { id: 102, title: 'Updated' };
    const ctx = { model: 'Article', trx: null };

    // Update
    ModelEvents.emit('Article', Hooks.AFTER_UPDATE, record, ctx);
    expect(mockLayer.tagsForMutation).toHaveBeenCalledWith(mockModel, { mode: 'smart' }, 'update', record);

    // Delete
    ModelEvents.emit('Article', Hooks.AFTER_DELETE, record, ctx);
    expect(mockLayer.tagsForMutation).toHaveBeenCalledWith(mockModel, { mode: 'smart' }, 'delete', record);

    // Restore
    ModelEvents.emit('Article', Hooks.AFTER_RESTORE, record, ctx);
    expect(mockLayer.tagsForMutation).toHaveBeenCalledWith(mockModel, { mode: 'smart' }, 'restore', record);
  });

  it('ignores mutation if model is not registered', async () => {
    registerOrmCacheListeners(mockLayer);

    const record = { id: 999 };
    const ctx = { model: 'UnknownModel', trx: null };

    ModelEvents.emit('UnknownModel', Hooks.AFTER_CREATE, record, ctx);
    expect(mockLayer.scheduleInvalidate).not.toHaveBeenCalled();
  });

  it('skips layer if strategyFor returns falsy/null', async () => {
    mockLayer.strategyFor.mockReturnValue(null);
    registerOrmCacheListeners(mockLayer);

    const record = { id: 103 };
    const ctx = { model: 'Article', trx: null };

    ModelEvents.emit('Article', Hooks.AFTER_CREATE, record, ctx);
    expect(mockLayer.tagsForMutation).not.toHaveBeenCalled();
    expect(mockLayer.scheduleInvalidate).not.toHaveBeenCalled();
  });

  it('unsubscribes global event handlers when all layers are removed', async () => {
    registerOrmCacheListeners(mockLayer);
    unregisterOrmCacheListeners(mockLayer);

    const record = { id: 104 };
    const ctx = { model: 'Article', trx: null };

    ModelEvents.emit('Article', Hooks.AFTER_CREATE, record, ctx);
    expect(mockLayer.scheduleInvalidate).not.toHaveBeenCalled();
  });
});

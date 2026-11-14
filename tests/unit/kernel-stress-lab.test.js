import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const {
  createApp,
  definePlugin,
  defineFlow,
  BaseRepository,
  createEventBus,
  buildContext,
  randomUUID,
  createViewEngine,
  renderTemplate,
  parseQualified,
} = require('../../core/kernel');
const { ConfigurationError, RouteNotFoundError } = require('../../core/errors');

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-kernel-stress-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Kernel Stress Lab', () => {
  it('1. handles 500 listeners, sequential dispatch chains, parallel publish bursts, and 1000 off() churn cycles', async () => {
    const bus = createEventBus();

    // 500 sequential listeners mutating a counter and appending step tags
    const handlers = [];
    for (let i = 0; i < 500; i++) {
      const fn = async (ctx) => {
        ctx.payload.count += 1;
        return i;
      };
      handlers.push(fn);
      bus.on('stress.chain', fn);
    }

    const ctx = buildContext({ count: 0 }, { source: 'system', requestId: 'req-chain-1', userId: 'u-1' });
    expect(ctx.meta.createdAt).toBeInstanceOf(Date);
    expect(ctx.meta.requestId).toBe('req-chain-1');

    const lastResult = await bus.dispatch('stress.chain', ctx);
    expect(ctx.payload.count).toBe(500);
    expect(lastResult).toBe(499);

    // Parallel publish across 50 concurrent bursts
    const parallelHits = [];
    bus.on('stress.parallel', async (c) => {
      await Promise.resolve();
      parallelHits.push(c.payload.idx);
    });
    bus.on('stress.parallel', (c) => {
      parallelHits.push(`sync-${c.payload.idx}`);
    });

    await Promise.all(
      Array.from({ length: 50 }, (_, idx) =>
        bus.publish('stress.parallel', buildContext({ idx }, { source: 'route' })),
      ),
    );
    expect(parallelHits).toHaveLength(100);

    // Unsubscribe churn: remove every other handler + 500 non-existent off() calls
    for (let i = 0; i < handlers.length; i += 2) {
      bus.off('stress.chain', handlers[i]);
      bus.off('stress.nonexistent', handlers[i]);
    }
    const ctxAfterOff = buildContext({ count: 0 }, { source: 'system' });
    await bus.dispatch('stress.chain', ctxAfterOff);
    expect(ctxAfterOff.payload.count).toBe(250);
  });

  it('2. executes 300 BaseRepository CRUD lifecycles with before/after hooks, payload mutation, and missing-id guards', async () => {
    const bus = createEventBus();
    const repo = new BaseRepository(bus, { resource: 'order', source: 'orm' });

    const audit = {
      beforeCreate: 0,
      afterCreate: 0,
      beforeUpdate: 0,
      afterUpdate: 0,
      beforeDelete: 0,
      afterDelete: 0,
    };

    bus.on('orm.order.beforeCreate', (ctx) => {
      audit.beforeCreate += 1;
      ctx.payload.data.normalized = String(ctx.payload.data.code).toUpperCase();
    });
    bus.on('orm.order.afterCreate', () => {
      audit.afterCreate += 1;
    });
    bus.on('orm.order.beforeUpdate', (ctx) => {
      audit.beforeUpdate += 1;
      ctx.payload.data = { ...ctx.payload.data, version: (ctx.payload.record.version || 0) + 1 };
    });
    bus.on('orm.order.afterUpdate', (ctx) => {
      audit.afterUpdate += 1;
      // previous snapshot must keep pre-update version
      expect(ctx.payload.record.version).toBeGreaterThan(ctx.payload.previous.version || 0);
    });
    bus.on('orm.order.beforeDelete', () => {
      audit.beforeDelete += 1;
    });
    bus.on('orm.order.afterDelete', () => {
      audit.afterDelete += 1;
    });

    // 150 creates (concurrent)
    const created = await Promise.all(
      Array.from({ length: 150 }, (_, i) =>
        repo.create({ code: `ord-${i}`, amount: i * 10 }),
      ),
    );
    expect(created).toHaveLength(150);
    expect(created[42].normalized).toBe('ORD-42');
    expect(typeof created[42].id).toBe('string');

    // 100 updates
    const updated = [];
    for (let i = 0; i < 100; i++) {
      const res = await repo.update(created[i].id, { amount: created[i].amount + 5 });
      updated.push(res);
    }
    expect(updated[10].version).toBe(1);
    expect(updated[10].amount).toBe(105);

    // 50 deletes
    for (let i = 0; i < 50; i++) {
      await repo.delete(created[i].id);
    }

    expect(audit).toEqual({
      beforeCreate: 150,
      afterCreate: 150,
      beforeUpdate: 100,
      afterUpdate: 100,
      beforeDelete: 50,
      afterDelete: 50,
    });

    // Deleted or unknown IDs must throw
    await expect(repo.update(created[0].id, { amount: 999 })).rejects.toThrow(`Record not found: ${created[0].id}`);
    await expect(repo.delete(created[0].id)).rejects.toThrow(`Record not found: ${created[0].id}`);
    await expect(repo.update(randomUUID(), { amount: 1 })).rejects.toThrow('Record not found:');
  });

  it('3. orchestrates 100 conditional flows and 40 plugins in createApp() with mid-flight unregistration', async () => {
    const app = createApp();
    const trace = [];

    // Register 40 plugins with both views and event hooks
    for (let p = 0; p < 40; p++) {
      const plugin = definePlugin({
        name: `plugin-${p}`,
        events(kernelApp) {
          kernelApp.events.on('app.ping', (ctx) => {
            if (ctx.payload.targetPlugin === p) {
              trace.push(`plugin-${p}`);
            }
          });
        },
        views() {
          return {
            namespace: `ns${p}`,
            pages: { index: `<div>Plugin ${p}: {{ msg }}</div>` },
            partials: { tag: `<span>#{{ tag }}</span>` },
          };
        },
      });
      app.registerPlugin(plugin);
    }

    // Register 100 flows (50 matching even, 50 matching odd)
    const unregisters = [];
    for (let f = 0; f < 100; f++) {
      const flow = defineFlow({
        id: `flow-${f}`,
        trigger: 'job.run',
        when: (ctx) => ctx.payload.parity === f % 2,
        actions: [
          async (ctx) => {
            ctx.payload.hits.push(f);
          },
        ],
      });
      unregisters.push(app.registerFlow(flow));
    }

    expect(app.flows).toHaveLength(100);

    // Trigger plugin + even flows
    await app.events.publish('app.ping', buildContext({ targetPlugin: 17 }, { source: 'plugin' }));
    expect(trace).toEqual(['plugin-17']);

    const evenCtx = buildContext({ parity: 0, hits: [] }, { source: 'system' });
    await app.events.dispatch('job.run', evenCtx);
    expect(evenCtx.payload.hits).toHaveLength(50);

    // Unregister first 50 flows
    for (let i = 0; i < 50; i++) {
      unregisters[i]();
    }
    expect(app.flows).toHaveLength(50);

    const afterUnregisterCtx = buildContext({ parity: 0, hits: [] }, { source: 'system' });
    await app.events.dispatch('job.run', afterUnregisterCtx);
    expect(afterUnregisterCtx.payload.hits).toHaveLength(25);

    // Verify plugin view rendering across registered namespaces
    expect(app.view.renderView('ns39::index', { msg: 'ok' })).toBe('<div>Plugin 39: ok</div>');
    expect(app.view.renderPartial('ns0::tag', { tag: 'fast' })).toBe('<span>#fast</span>');
  });

  it('4. resolves 50 namespaces across app/theme/plugin tiers with cache invalidation and deep template rendering', () => {
    const root = makeTempDir();
    const appViews = path.join(root, 'appViews');
    const themeViews = path.join(root, 'themeViews');

    const engine = createViewEngine({ appViews, themeViews, cache: true });

    // Register 50 plugin bundles
    for (let i = 0; i < 50; i++) {
      engine.registerPluginViews(`mod-${i}`, {
        namespace: `m${i}`,
        layouts: { base: '<main data-m="' + i + '">{{ content }}</main>' },
        pages: { home: '<p>{{ user.profile.name }}|{{ missing.val }}|{{ flag }}</p>' },
        partials: { chip: '<i>{{ text }}</i>' },
      });
    }

    // Override mod-10 in themeViews and mod-20 in both appViews & themeViews (appViews wins)
    const themePage10 = path.join(themeViews, 'mod-10', 'pages', 'home.html');
    fs.mkdirSync(path.dirname(themePage10), { recursive: true });
    fs.writeFileSync(themePage10, '<theme-10>{{ title }}</theme-10>');

    const themePage20 = path.join(themeViews, 'mod-20', 'pages', 'home.html');
    fs.mkdirSync(path.dirname(themePage20), { recursive: true });
    fs.writeFileSync(themePage20, '<theme-20>{{ title }}</theme-20>');

    const appPage20 = path.join(appViews, 'plugins', 'mod-20', 'pages', 'home.html');
    fs.mkdirSync(path.dirname(appPage20), { recursive: true });
    fs.writeFileSync(appPage20, '<app-20>{{ title }}</app-20>');

    expect(engine.renderView('m10::home', { title: 'T10' })).toBe('<theme-10>T10</theme-10>');
    expect(engine.renderView('m20::home', { title: 'A20' }, { layout: 'm20::base' })).toBe(
      '<main data-m="20"><app-20>A20</app-20></main>',
    );

    // Deep dotted template + falsy handling
    const renderedInline = engine.renderView('m5::home', {
      user: { profile: { name: 'Ada' } },
      flag: false,
    });
    expect(renderedInline).toBe('<p>Ada||</p>');

    // Cache hit persists across file update until clearCache()
    fs.writeFileSync(appPage20, '<app-20-v2>{{ title }}</app-20-v2>');
    expect(engine.renderView('m20::home', { title: 'Cached' })).toBe('<app-20>Cached</app-20>');
    engine.clearCache();
    expect(engine.renderView('m20::home', { title: 'Fresh' })).toBe('<app-20-v2>Fresh</app-20-v2>');

    // Large template with 300 placeholders
    const bigTemplate = Array.from({ length: 300 }, (_, k) => `{{ items.k${k} }}`).join(',');
    const items = Object.fromEntries(Array.from({ length: 300 }, (_, k) => [`k${k}`, k]));
    const bigOut = renderTemplate(bigTemplate, { items });
    expect(bigOut.split(',')).toHaveLength(300);

    // Error contracts
    expect(() => parseQualified('invalid-no-sep')).toThrow(ConfigurationError);
    expect(() => engine.renderView('m0::nonexistent', {})).toThrow(RouteNotFoundError);
    expect(() => engine.renderView('m0::home', { user: { profile: { name: 'X' } } }, { layout: 'm0::missing' })).toThrow(
      RouteNotFoundError,
    );
    expect(() => engine.renderPartial('m0::missing', {})).toThrow(RouteNotFoundError);
  });
});


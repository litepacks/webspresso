/**
 * Application kernel unit tests (event bus, repository hooks, flows, views).
 */

const path = require('path');
const fs = require('fs');
const {
  createApp,
  definePlugin,
  defineFlow,
  BaseRepository,
  createEventBus,
  createViewEngine,
  renderTemplate,
  parseQualified,
} = require('../../core/kernel');

class PostRepo extends BaseRepository {
  constructor(events) {
    super(events, { resource: 'post' });
  }
}

describe('kernel event bus', () => {
  it('dispatch runs sequentially and can mutate payload', async () => {
    const bus = createEventBus();
    bus.on('test', async (ctx) => {
      ctx.payload.order.push(1);
    });
    bus.on('test', async (ctx) => {
      ctx.payload.order.push(2);
    });
    const ctx = bus.buildContext({ order: [] }, { source: 'system' });
    await bus.dispatch('test', ctx);
    expect(ctx.payload.order).toEqual([1, 2]);
  });

  it('publish runs all handlers', async () => {
    const bus = createEventBus();
    const calls = [];
    bus.on('x', async () => {
      calls.push('a');
    });
    bus.on('x', async () => {
      calls.push('b');
    });
    await bus.publish('x', bus.buildContext({}, { source: 'system' }));
    expect(calls.length).toBe(2);
  });

  it('dispatch returns the last handler result', async () => {
    const bus = createEventBus();
    bus.on('n', async () => 'a');
    bus.on('n', async () => 'b');
    const out = await bus.dispatch('n', bus.buildContext({}, { source: 'system' }));
    expect(out).toBe('b');
  });

  it('off unsubscribes handler', async () => {
    const bus = createEventBus();
    const calls = [];
    const h = async () => {
      calls.push(1);
    };
    bus.on('e', h);
    await bus.dispatch('e', bus.buildContext({}, { source: 'system' }));
    bus.off('e', h);
    await bus.dispatch('e', bus.buildContext({}, { source: 'system' }));
    expect(calls).toEqual([1]);
  });

  it('dispatch propagates errors', async () => {
    const bus = createEventBus();
    bus.on('bad', async () => {
      throw new Error('boom');
    });
    await expect(
      bus.dispatch('bad', bus.buildContext({}, { source: 'system' })),
    ).rejects.toThrow('boom');
  });

  it('buildContext carries requestId and userId', () => {
    const bus = createEventBus();
    const ctx = bus.buildContext(
      { x: 1 },
      { source: 'route', requestId: 'rid-1', userId: 'u-9' },
    );
    expect(ctx.payload).toEqual({ x: 1 });
    expect(ctx.meta.requestId).toBe('rid-1');
    expect(ctx.meta.userId).toBe('u-9');
    expect(ctx.meta.source).toBe('route');
    expect(ctx.meta.createdAt).toBeInstanceOf(Date);
  });

  it('dispatch with no handlers returns undefined', async () => {
    const bus = createEventBus();
    const out = await bus.dispatch('empty', bus.buildContext({}, { source: 'system' }));
    expect(out).toBeUndefined();
  });

  it('off is safe when handler was not registered', () => {
    const bus = createEventBus();
    const h = async () => {};
    bus.off('none', h);
    bus.off('none', async () => {});
  });
});

describe('kernel defineFlow / definePlugin wrappers', () => {
  it('defineFlow returns the same definition object', () => {
    const def = defineFlow({
      trigger: 't',
      actions: [],
    });
    expect(def.trigger).toBe('t');
  });

  it('sample-seo plugin module exports describePlugin descriptor', () => {
    const sample = require('../../core/kernel/plugins/sample-seo');
    expect(sample.name).toBe('seo-plugin');
    expect(typeof sample.views).toBe('function');
    expect(typeof sample.events).toBe('function');
    expect(sample.views().namespace).toBe('seo');
  });

  it('sample-seo events hook logs on orm.post.afterCreate', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const sample = require('../../core/kernel/plugins/sample-seo');
    /** @type {undefined | (() => unknown)} */
    let handler;
    sample.events({
      events: {
        on: (_evt, fn) => {
          handler = fn;
        },
      },
    });
    await /** @type {() => Promise<void>} */ (handler)();
    expect(spy).toHaveBeenCalledWith('[plugin] SEO update triggered');
    spy.mockRestore();
  });
});

describe('kernel repo + flows', () => {
  it('create fires beforeCreate, afterCreate, plugin, conditional flow', async () => {
    const log = [];
    const app = createApp();

    app.events.on('orm.post.beforeCreate', async () => {
      log.push('beforeCreate');
    });
    app.events.on('orm.post.afterCreate', async () => {
      log.push('afterCreate');
    });

    app.registerPlugin({
      name: 'p',
      events(a) {
        a.events.on('orm.post.afterCreate', async () => {
          log.push('plugin');
        });
      },
    });

    app.registerFlow(
      defineFlow({
        trigger: 'orm.post.afterCreate',
        when: (ctx) => ctx.payload.record?.status === 'published',
        actions: [
          async () => {
            log.push('flow');
          },
        ],
      }),
    );

    const posts = new PostRepo(app.events);
    await posts.create({ title: 't', status: 'published' });

    expect(log[0]).toBe('beforeCreate');
    expect(log).toContain('afterCreate');
    expect(log).toContain('plugin');
    expect(log).toContain('flow');
  });

  it('registerFlow when returns false skips actions', async () => {
    const ran = [];
    const app = createApp();
    app.registerFlow(
      defineFlow({
        trigger: 'custom.event',
        when: () => false,
        actions: [
          async () => {
            ran.push('x');
          },
        ],
      }),
    );
    await app.events.publish('custom.event', app.events.buildContext({}, { source: 'system' }));
    expect(ran).toEqual([]);
  });

  it('registerFlow unregister removes handler', async () => {
    let n = 0;
    const app = createApp();
    const unregister = app.registerFlow(
      defineFlow({
        id: 'one-shot',
        trigger: 'tick',
        actions: [
          async () => {
            n += 1;
          },
        ],
      }),
    );
    await app.events.publish('tick', app.events.buildContext({}, { source: 'system' }));
    expect(n).toBe(1);
    unregister();
    await app.events.publish('tick', app.events.buildContext({}, { source: 'system' }));
    expect(n).toBe(1);
  });

  it('flows getter lists registered flows', () => {
    const app = createApp();
    app.registerFlow(defineFlow({ trigger: 'a', actions: [async () => {}] }));
    app.registerFlow(defineFlow({ id: 'x', trigger: 'b', actions: [async () => {}] }));
    const ids = app.flows.map((f) => f.id);
    expect(ids).toContain('a');
    expect(ids).toContain('x');
    expect(app.flows.some((f) => f.trigger === 'b')).toBe(true);
  });

  it('registerPlugin registers views for renderView', () => {
    const app = createApp();
    const p = definePlugin({
      name: 'catalog-plugin',
      views() {
        return {
          namespace: 'shop',
          layouts: {},
          pages: { item: 'SKU {{ sku }}' },
          partials: {},
        };
      },
    });
    app.registerPlugin(p);
    expect(app.view.renderView('shop::item', { sku: '42' })).toBe('SKU 42');
  });
});

describe('kernel BaseRepository lifecycle', () => {
  it('update runs beforeUpdate and afterUpdate', async () => {
    const phases = [];
    const bus = createEventBus();
    bus.on('orm.item.beforeUpdate', async () => {
      phases.push('before');
    });
    bus.on('orm.item.afterUpdate', async () => {
      phases.push('after');
    });
    const repo = new (class extends BaseRepository {
      constructor() {
        super(bus, { resource: 'item' });
      }
    })();
    const row = await repo.create({ title: 'x' });
    phases.length = 0;
    await repo.update(row.id, { title: 'y' });
    expect(phases).toEqual(['before', 'after']);
  });

  it('delete runs beforeDelete and afterDelete', async () => {
    const phases = [];
    const bus = createEventBus();
    bus.on('orm.item.beforeDelete', async () => {
      phases.push('before');
    });
    bus.on('orm.item.afterDelete', async () => {
      phases.push('after');
    });
    const repo = new (class extends BaseRepository {
      constructor() {
        super(bus, { resource: 'item' });
      }
    })();
    const row = await repo.create({});
    await repo.delete(row.id);
    expect(phases).toEqual(['before', 'after']);
  });

  it('update and delete throw when id missing', async () => {
    const bus = createEventBus();
    const repo = new (class extends BaseRepository {
      constructor() {
        super(bus, { resource: 'item' });
      }
    })();
    await expect(repo.update('missing', {})).rejects.toThrow('Record not found: missing');
    await expect(repo.delete('missing')).rejects.toThrow('Record not found: missing');
  });
});

describe('kernel view resolver', () => {
  it('renders inline plugin template', () => {
    const view = createViewEngine({});
    view.registerPluginViews('demo-plugin', {
      namespace: 'demo',
      pages: { hello: 'Hi {{ name }}' },
    });
    expect(view.renderView('demo::hello', { name: 'U' })).toBe('Hi U');
  });

  it('prefers app override then theme then plugin bundle', () => {
    const tmp = path.join(__dirname, '../fixtures/kernel-view-tmp');
    const appRoot = path.join(tmp, 'app', 'plugins', 'demo-plugin', 'pages');
    const themeRoot = path.join(tmp, 'theme', 'demo-plugin', 'pages');
    fs.mkdirSync(appRoot, { recursive: true });
    fs.mkdirSync(themeRoot, { recursive: true });
    try {
      fs.writeFileSync(path.join(appRoot, 'page.html'), 'APP');
      fs.writeFileSync(path.join(themeRoot, 'page.html'), 'THEME');

      const view = createViewEngine({
        appViews: path.join(tmp, 'app'),
        themeViews: path.join(tmp, 'theme'),
      });
      view.registerPluginViews('demo-plugin', {
        namespace: 'demo',
        pages: { page: 'INLINE' },
      });

      expect(view.renderView('demo::page', {})).toBe('APP');

      fs.unlinkSync(path.join(appRoot, 'page.html'));
      expect(view.renderView('demo::page', {})).toBe('THEME');

      fs.unlinkSync(path.join(themeRoot, 'page.html'));
      expect(view.renderView('demo::page', {})).toBe('INLINE');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('parseQualified rejects non-namespaced names', () => {
    expect(() => parseQualified('nocolon')).toThrow('namespaced');
  });

  it('renderView throws when view missing', () => {
    const view = createViewEngine({});
    expect(() => view.renderView('missing::x', {})).toThrow('View not found');
  });

  it('renderView throws when layout missing', () => {
    const view = createViewEngine({});
    view.registerPluginViews('p', {
      namespace: 'a',
      pages: { body: 'Hi' },
      layouts: {},
      partials: {},
    });
    expect(() => view.renderView('a::body', {}, { layout: 'a::ghost' })).toThrow(
      'Layout not found',
    );
  });

  it('renderPartial resolves and renders', () => {
    const view = createViewEngine({});
    view.registerPluginViews('p', {
      namespace: 'a',
      layouts: {},
      pages: {},
      partials: { chip: '{{ label }}' },
    });
    expect(view.renderPartial('a::chip', { label: 'ok' })).toBe('ok');
  });

  it('renderPartial throws when missing', () => {
    const view = createViewEngine({});
    expect(() => view.renderPartial('x::nope', {})).toThrow('Partial not found');
  });

  it('renderView wraps layout with content slot', () => {
    const view = createViewEngine({});
    view.registerPluginViews('p', {
      namespace: 'a',
      layouts: { shell: '<wrap>{{ content }}</wrap>' },
      pages: { inner: 'INNER' },
      partials: {},
    });
    expect(view.renderView('a::inner', {}, { layout: 'a::shell' })).toBe(
      '<wrap>INNER</wrap>',
    );
  });

  it('renderTemplate supports dotted paths', () => {
    expect(renderTemplate('{{ a.b }}', { a: { b: 7 } })).toBe('7');
  });

  it('renderTemplate yields empty string for missing nested path', () => {
    expect(renderTemplate('{{ a.b }}', { a: null })).toBe('');
  });

  it('parseQualified allows double-colon in name segment', () => {
    const q = parseQualified('ns::part::rest');
    expect(q.namespace).toBe('ns');
    expect(q.name).toBe('part::rest');
  });

  it('registerPluginViews without filesystem entry uses plugin namespace as slug', () => {
    const view = createViewEngine({});
    view.registerPluginViews('my-plugin-slug', {
      namespace: 'ns',
      pages: { p: 'v' },
      layouts: {},
      partials: {},
    });
    expect(view.renderView('ns::p', {})).toBe('v');
  });
});

const { redirectPlugin } = require('../../plugins/redirect');

describe('Redirect Plugin (plugins/redirect)', () => {
  it('should compile string and regex rules and redirect matching requests', () => {
    const plugin = redirectPlugin({
      rules: [
        { from: '/old-about', to: '/about', status: 301 },
        { from: /^\/blog\/old-(.*)/, to: '/posts', status: 302 },
      ],
    });

    let middleware;
    const mockApp = {
      use(fn) {
        middleware = fn;
      },
    };

    plugin.register({ app: mockApp });
    expect(typeof middleware).toBe('function');

    // Test string match
    let redirectedStatus = null;
    let redirectedLocation = null;
    let nextCalled = false;

    const res = {
      redirect(status, loc) {
        redirectedStatus = status;
        redirectedLocation = loc;
      },
    };

    middleware({ path: '/old-about', method: 'GET', url: '/old-about?ref=twitter' }, res, () => {
      nextCalled = true;
    });

    expect(redirectedStatus).toBe(301);
    expect(redirectedLocation).toBe('/about?ref=twitter');
    expect(nextCalled).toBe(false);

    // Test regex match
    redirectedStatus = null;
    redirectedLocation = null;
    middleware({ path: '/blog/old-post-1', method: 'GET', url: '/blog/old-post-1' }, res, () => {});
    expect(redirectedStatus).toBe(302);
    expect(redirectedLocation).toBe('/posts');
  });

  it('should respect allowExternal flag for external URLs', () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      // Disallowed external
      const plugin1 = redirectPlugin({
        allowExternal: false,
        rules: [{ from: '/docs', to: 'https://example.com/docs' }],
      });
      expect(warnings.some(w => w.includes('external `to` requires allowExternal'))).toBe(true);

      // Allowed external
      const plugin2 = redirectPlugin({
        allowExternal: true,
        rules: [{ from: '/docs', to: 'https://example.com/docs' }],
      });

      let middleware;
      plugin2.register({ app: { use: (fn) => { middleware = fn; } } });

      let loc = null;
      middleware({ path: '/docs', method: 'GET' }, { redirect: (_, l) => { loc = l; } }, () => {});
      expect(loc).toBe('https://example.com/docs');
    } finally {
      console.warn = origWarn;
    }
  });

  it('should handle trailing slash modes ("strip" and "add")', () => {
    // Strip mode
    const pluginStrip = redirectPlugin({
      trailingSlash: 'strip',
      rules: [{ from: '/products', to: '/items' }],
    });
    let mwStrip;
    pluginStrip.register({ app: { use: fn => { mwStrip = fn; } } });

    let loc = null;
    mwStrip({ path: '/products/', method: 'GET' }, { redirect: (_, l) => { loc = l; } }, () => {});
    expect(loc).toBe('/items');

    // Add mode
    const pluginAdd = redirectPlugin({
      trailingSlash: 'add',
      rules: [{ from: '/products/', to: '/items' }],
    });
    let mwAdd;
    pluginAdd.register({ app: { use: fn => { mwAdd = fn; } } });

    loc = null;
    mwAdd({ path: '/products', method: 'GET' }, { redirect: (_, l) => { loc = l; } }, () => {});
    expect(loc).toBe('/items');
  });

  it('should filter by HTTP methods correctly', () => {
    const plugin = redirectPlugin({
      rules: [
        { from: '/submit', to: '/thanks', methods: ['POST'] },
        { from: '/any', to: '/dest', methods: '*' },
      ],
    });

    let mw;
    plugin.register({ app: { use: fn => { mw = fn; } } });

    let nextCalled = false;
    mw({ path: '/submit', method: 'GET' }, { redirect: () => {} }, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);

    let postRedirect = false;
    mw({ path: '/submit', method: 'POST' }, { redirect: () => { postRedirect = true; } }, () => {});
    expect(postRedirect).toBe(true);

    let anyRedirect = false;
    mw({ path: '/any', method: 'DELETE' }, { redirect: () => { anyRedirect = true; } }, () => {});
    expect(anyRedirect).toBe(true);
  });

  it('should skip invalid rules and empty rules registration', () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
      const plugin = redirectPlugin({
        rules: [
          null,
          { from: '/no-to' },
          { from: 123, to: '/target' },
        ],
      });

      let used = false;
      plugin.register({ app: { use: () => { used = true; } } });
      expect(used).toBe(false);
    } finally {
      console.warn = origWarn;
    }
  });
});

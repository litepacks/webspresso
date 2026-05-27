/**
 * Analytics plugin — helper registration smoke
 */

const { analyticsPlugin } = require('../../plugins');

describe('Analytics plugin (integration)', () => {
  it('registers gtag helper that emits measurement id', () => {
    const plugin = analyticsPlugin({ google: { measurementId: 'G-TEST123' } });
    const helpers = {};
    plugin.register({
      addHelper(name, fn) {
        helpers[name] = fn;
      },
      addFilter() {},
    });
    const html = helpers.gtag();
    expect(html).toContain('G-TEST123');
    expect(html).toContain('googletagmanager.com');
  });
});

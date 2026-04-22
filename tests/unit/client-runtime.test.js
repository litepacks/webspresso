/**
 * clientRuntime resolution
 */

const { resolveClientRuntime } = require('../../src/client-runtime/resolve');

describe('resolveClientRuntime', () => {
  afterEach(() => {
    delete process.env.WEBSPRESSO_ALPINE;
    delete process.env.WEBSPRESSO_SWUP;
  });

  it('defaults both flags off', () => {
    expect(resolveClientRuntime({})).toEqual({ alpine: false, swup: false });
  });

  it('enables alpine from options', () => {
    expect(resolveClientRuntime({ clientRuntime: { alpine: true } })).toEqual({
      alpine: true,
      swup: false,
    });
  });

  it('treats object sub-options as enabled', () => {
    expect(resolveClientRuntime({ clientRuntime: { alpine: {}, swup: {} } })).toEqual({
      alpine: true,
      swup: true,
    });
  });

  it('env overrides options', () => {
    process.env.WEBSPRESSO_ALPINE = '0';
    process.env.WEBSPRESSO_SWUP = 'true';
    expect(
      resolveClientRuntime({ clientRuntime: { alpine: true, swup: false } })
    ).toEqual({ alpine: false, swup: true });
  });
});

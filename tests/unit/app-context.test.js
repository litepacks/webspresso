/**
 * @vitest-environment node
 */

const {
  attachDbMiddleware,
  getAppContext,
  getDb,
  hasDb,
  resetAppContext,
  setAppContext,
} = require('../../src/app-context');

describe('app-context', () => {
  beforeEach(() => {
    resetAppContext();
  });

  afterEach(() => {
    resetAppContext();
  });

  it('getAppContext returns db null by default', () => {
    expect(getAppContext().db).toBeNull();
    expect(hasDb()).toBe(false);
  });

  it('setAppContext registers db', () => {
    const fake = { knex: {} };
    setAppContext({ db: fake });
    expect(getAppContext().db).toBe(fake);
    expect(hasDb()).toBe(true);
    expect(getDb()).toBe(fake);
  });

  it('getDb throws when db missing', () => {
    expect(() => getDb()).toThrow(/No database registered/);
  });

  it('resetAppContext clears db', () => {
    setAppContext({ db: {} });
    resetAppContext();
    expect(hasDb()).toBe(false);
    expect(() => getDb()).toThrow();
  });

  it('attachDbMiddleware sets req.db from context', () => {
    const marker = { k: 1 };
    setAppContext({ db: marker });
    const req = {};
    const next = vi.fn();
    attachDbMiddleware(req, {}, next);
    expect(req.db).toBe(marker);
    expect(next).toHaveBeenCalled();
  });
});

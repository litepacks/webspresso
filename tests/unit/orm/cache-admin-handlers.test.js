const {
  createMockRes
} = require('../../utils');

/**
 * ORM cache admin API handlers
 */
const { createOrmCacheAdminHandlers } = require('../../../plugins/orm-cache-admin/api-handlers');

describe('orm-cache-admin handlers', () => {
  it('getStats returns 503 when cache off', async () => {
    const handlers = createOrmCacheAdminHandlers({ db: { cache: null } });
    const res = createMockRes();
    await handlers.getStats({}, res);
    expect(res.statusCode).toBe(503);
  });

  it('postPurge calls purge', async () => {
    let purged = false;
    const handlers = createOrmCacheAdminHandlers({
      db: {
        cache: {
          purge() {
            purged = true;
          },
        },
      },
    });
    const res = createMockRes();
    await handlers.postPurge({}, res);
    expect(purged).toBe(true);
    expect(res._body.ok).toBe(true);
  });

  it('postInvalidate accepts model', async () => {
    let modelArg;
    const handlers = createOrmCacheAdminHandlers({
      db: {
        cache: {
          invalidateModel(name) {
            modelArg = name;
          },
        },
      },
    });
    const res = createMockRes();
    await handlers.postInvalidate({ body: { model: 'User' } }, res);
    expect(modelArg).toBe('User');
    expect(res._body.ok).toBe(true);
  });
});

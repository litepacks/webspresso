const { createCustomPageApiHandlers } = require('../../../plugins/admin-panel/modules/custom-pages');
const { AdminRegistry } = require('../../../plugins/admin-panel/core/registry');

describe('Custom Page Actions API Handlers', () => {
  let registry;
  let mockDb;
  let pageHandlers;

  beforeEach(() => {
    registry = new AdminRegistry();
    mockDb = {};
    pageHandlers = createCustomPageApiHandlers({ registry, db: mockDb });

    registry.registerPage('test-page', {
      title: 'Test Page',
      path: '/test-page',
      actions: {
        save: async ({ db, req, body, query, payload }) => {
          return {
            receivedBody: body,
            receivedQuery: query,
            receivedPayload: payload,
            queryName: query.name,
            bodyCode: body.code,
          };
        },
      },
    });
  });

  it('should return 404 if page does not exist', async () => {
    const req = { params: { pageId: 'unknown', actionId: 'save' } };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await pageHandlers.executePageAction(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Page not found' });
  });

  it('should return 404 if action does not exist on page', async () => {
    const req = { params: { pageId: 'test-page', actionId: 'unknown' } };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await pageHandlers.executePageAction(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Action not found' });
  });

  it('should execute action and merge req.query and req.body seamlessly', async () => {
    const req = {
      params: { pageId: 'test-page', actionId: 'save' },
      query: { name: 'Portugal' },
      body: { code: 'PT' },
      session: { adminUser: { id: 1, email: 'admin@test.com' } },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await pageHandlers.executePageAction(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      result: {
        receivedBody: { name: 'Portugal', code: 'PT' },
        receivedQuery: { name: 'Portugal' },
        receivedPayload: { name: 'Portugal', code: 'PT' },
        queryName: 'Portugal',
        bodyCode: 'PT',
      },
    });
  });
});

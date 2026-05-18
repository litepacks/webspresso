/**
 * HTTP error helpers
 */

const { preferJsonErrorResponse, createHttpError } = require('../../../src/http/errors');

describe('http/errors', () => {
  it('preferJsonErrorResponse is true for /api paths', () => {
    expect(preferJsonErrorResponse({ path: '/api/health' })).toBe(true);
  });

  it('preferJsonErrorResponse is false when Accept is text/html', () => {
    expect(
      preferJsonErrorResponse({
        path: '/about',
        accepts: (t) => t === 'html',
      })
    ).toBe(false);
  });

  it('preferJsonErrorResponse defaults to json for non-API HTML paths without accepts', () => {
    expect(preferJsonErrorResponse({ path: '/about' })).toBe(true);
  });

  it('createHttpError sets status', () => {
    const err = createHttpError('Forbidden', 403);
    expect(err.message).toBe('Forbidden');
    expect(err.status).toBe(403);
  });
});

/**
 * createAppFromManifest tests
 */

const { createAppFromManifest } = require('../../../core/build');
const { createAppFromManifest: createWorkerAppFromManifest } = require('../../../core/build/runtime/create-app-from-manifest');

describe('createAppFromManifest', () => {
  it('requires manifest and handlers (Node export)', () => {
    expect(() => createAppFromManifest({ pagesDir: '/tmp/pages' })).toThrow(
      'createAppFromManifest requires manifest and handlers'
    );
  });

  it('requires manifest and handlers (Worker export)', () => {
    expect(() => createWorkerAppFromManifest({ pagesDir: '/tmp/pages' })).toThrow(
      'createAppFromManifest requires manifest and handlers'
    );
  });
});

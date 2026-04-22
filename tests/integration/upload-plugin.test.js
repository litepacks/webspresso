/**
 * Upload plugin integration tests (multer + createApp)
 */

const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const request = require('supertest');
const { createApp } = require('../../src/server');
const { uploadPlugin } = require('../../plugins/upload');

const FIXTURES_PAGES = path.join(__dirname, '..', 'fixtures', 'pages');
const FIXTURES_VIEWS = path.join(__dirname, '..', 'fixtures', 'views');

async function makeUploadApp(overrides = {}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-up-'));
  const publicRoot = path.join(tmp, 'public');
  const destDir = path.join(publicRoot, 'uploads');
  await fs.mkdir(destDir, { recursive: true });

  const plugin = uploadPlugin({
    path: '/api/upload',
    local: { destDir, publicBasePath: '/uploads' },
    maxBytes: 8000,
    mimeAllowlist: null,
    extensionAllowlist: null,
    ...overrides.plugin,
  });

  const { app } = createApp({
    pagesDir: FIXTURES_PAGES,
    viewsDir: FIXTURES_VIEWS,
    publicDir: publicRoot,
    plugins: [plugin],
  });

  return { app, destDir, tmp };
}

describe('uploadPlugin', () => {
  it('should return 200 and JSON url on successful POST', async () => {
    const { app } = await makeUploadApp();

    const res = await request(app)
      .post('/api/upload')
      .attach('file', Buffer.from('hello world'), 'note.txt')
      .expect(200);

    expect(res.body.url || res.body.publicUrl).toBeTruthy();
    expect(res.body.url).toBe(res.body.publicUrl);
  });

  it('should reject oversized uploads with 413', async () => {
    const { app } = await makeUploadApp({
      plugin: { maxBytes: 10 },
    });

    const res = await request(app)
      .post('/api/upload')
      .attach('file', Buffer.alloc(200), 'big.bin');

    expect(res.status).toBe(413);
    expect(res.body.message || res.body.error).toBeTruthy();
  });

  it('should reject MIME not in allowlist with 415', async () => {
    const { app } = await makeUploadApp({
      plugin: { mimeAllowlist: ['image/png'] },
    });

    const res = await request(app)
      .post('/api/upload')
      .attach('file', Buffer.from('x'), {
        filename: 'x.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(415);
  });

  it('should reject extension not in allowlist with 400', async () => {
    const { app } = await makeUploadApp({
      plugin: { extensionAllowlist: ['png'] },
    });

    const res = await request(app)
      .post('/api/upload')
      .attach('file', Buffer.from('x'), 'x.exe');

    expect(res.status).toBe(400);
  });

  it('should apply optional middleware before handler', async () => {
    const { app } = await makeUploadApp({
      plugin: {
        middleware: [(req, res) => res.status(401).json({ error: 'nope' })],
      },
    });

    await request(app).post('/api/upload').attach('file', Buffer.from('a'), 'a.txt').expect(401);
  });
});

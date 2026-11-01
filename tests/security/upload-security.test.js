const {
  createTempDir,
  cleanupDir
} = require('../utils');

const request = require('supertest');
const { createApp } = require('../../src/server');
const { uploadPlugin } = require('../../plugins/upload');
const path = require('path');
const fs = require('fs');

const PAGES_DIR = path.join(__dirname, '../fixtures/route-order/pages');
const VIEWS_DIR = path.join(__dirname, '../fixtures/route-order/views');
const TEMP_UPLOAD_DIR = createTempDir('temp-security-uploads');

describe('Security: File Upload Plugin', () => {
  beforeAll(() => {
    if (!fs.existsSync(TEMP_UPLOAD_DIR)) {
      fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    cleanupDir(TEMP_UPLOAD_DIR);
  });

  it('should prevent path traversal in originalName and save strictly inside upload dir', async () => {
    const { app } = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      plugins: [
        uploadPlugin({
          local: {
            destDir: TEMP_UPLOAD_DIR,
            publicBasePath: '/uploads',
          },
        }),
      ],
    });

    const res = await request(app)
      .post('/api/upload')
      .attach('file', Buffer.from('safe file content'), '../../../../evil.txt')
      .expect(200);

    expect(res.body.url).toBeDefined();
    // Verify file is saved inside destDir and not outside
    const filename = res.body.url.replace('/uploads/', '');
    expect(filename).not.toContain('..');
    const fullSavedPath = path.join(TEMP_UPLOAD_DIR, filename);
    expect(fs.existsSync(fullSavedPath)).toBe(true);
  });

  it('rejects browser-executable uploads (HTML/JS/SVG/XML) by default', async () => {
    const { app } = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      plugins: [uploadPlugin({ local: { destDir: TEMP_UPLOAD_DIR } })],
    });

    const cases = [
      ['page.html', 'text/html'],
      ['steal.js', 'application/javascript'],
      ['logo.svg', 'image/svg+xml'],
      ['feed.xml', 'application/xml'],
      ['disguised.html', 'application/octet-stream'], // extension alone is enough
      ['innocent.png', 'text/html'], // MIME alone is enough
    ];
    for (const [name, contentType] of cases) {
      const res = await request(app).post('/api/upload').attach('file', Buffer.from('<script>x</script>'), { filename: name, contentType });
      expect(res.status, name).toBe(415);
    }

    await request(app)
      .post('/api/upload')
      .attach('file', Buffer.from('plain'), { filename: 'notes.txt', contentType: 'text/plain' })
      .expect(200);
  });

  it('accepts executable types when explicitly allowlisted or allowExecutable is set', async () => {
    const svgOnly = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      plugins: [uploadPlugin({ local: { destDir: TEMP_UPLOAD_DIR }, mimeAllowlist: ['image/svg+xml'] })],
    });
    await request(svgOnly.app)
      .post('/api/upload')
      .attach('file', Buffer.from('<svg/>'), { filename: 'logo.svg', contentType: 'image/svg+xml' })
      .expect(200);

    const anything = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      plugins: [uploadPlugin({ local: { destDir: TEMP_UPLOAD_DIR }, allowExecutable: true })],
    });
    await request(anything.app)
      .post('/api/upload')
      .attach('file', Buffer.from('<p>hi</p>'), { filename: 'page.html', contentType: 'text/html' })
      .expect(200);
  });

  it('should enforce MIME allowlist and reject disallowed types (415)', async () => {
    const { app } = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      plugins: [
        uploadPlugin({
          local: { destDir: TEMP_UPLOAD_DIR },
          mimeAllowlist: ['image/jpeg', 'image/png'],
        }),
      ],
    });

    // Upload text file when only images allowed
    await request(app)
      .post('/api/upload')
      .attach('file', Buffer.from('malicious payload'), {
        filename: 'malware.sh',
        contentType: 'application/x-sh',
      })
      .expect(415);
  });

  it('should enforce max file size limit (413)', async () => {
    const { app } = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
      plugins: [
        uploadPlugin({
          local: { destDir: TEMP_UPLOAD_DIR },
          maxBytes: 100, // 100 bytes max
        }),
      ],
    });

    const largeBuffer = Buffer.alloc(500, 'a');
    await request(app)
      .post('/api/upload')
      .attach('file', largeBuffer, 'large.png')
      .expect(413);
  });
});

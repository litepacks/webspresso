const request = require('supertest');
const { createApp } = require('../../src/server');
const { uploadPlugin } = require('../../plugins/upload');
const path = require('path');
const fs = require('fs');

const PAGES_DIR = path.join(__dirname, '../fixtures/route-order/pages');
const VIEWS_DIR = path.join(__dirname, '../fixtures/route-order/views');
const TEMP_UPLOAD_DIR = path.join(__dirname, '../fixtures/temp-security-uploads');

describe('Security: File Upload Plugin', () => {
  beforeAll(() => {
    if (!fs.existsSync(TEMP_UPLOAD_DIR)) {
      fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(TEMP_UPLOAD_DIR)) {
      fs.rmSync(TEMP_UPLOAD_DIR, { recursive: true, force: true });
    }
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

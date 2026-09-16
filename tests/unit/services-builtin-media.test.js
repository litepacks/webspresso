const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { createServiceRegistry } = require('../../src/services');
const { createMediaServices } = require('../../src/services/builtins/media');
const { createApp } = require('../../src/server');
const { uploadPlugin } = require('../../plugins/upload');

describe('Built-in Media Services (media.*)', () => {
  let tmpDir;
  let services;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webspresso-media-test-'));
    services = createServiceRegistry();
    const mediaMap = createMediaServices({
      destDir: tmpDir,
      publicBasePath: '/uploads',
    });
    for (const [name, def] of Object.entries(mediaMap)) {
      services.register(name, def);
    }
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (e) {}
  });

  describe('media.upload', () => {
    it('should upload file from Buffer and return metadata', async () => {
      const buffer = Buffer.from('Hello Webspresso Media');
      const res = await services.call('media.upload', {
        buffer,
        originalName: 'hello.txt',
        mimeType: 'text/plain',
      });

      expect(res.publicUrl).toBeDefined();
      expect(res.publicUrl.startsWith('/uploads/')).toBe(true);
      expect(res.key).toBeDefined();
      expect(res.size).toBe(buffer.length);
      expect(res.mimeType).toBe('text/plain');
      expect(res.originalName).toBe('hello.txt');

      // Verify file exists on disk
      const diskContent = await fs.readFile(path.join(tmpDir, res.key), 'utf-8');
      expect(diskContent).toBe('Hello Webspresso Media');
    });

    it('should upload file from Base64 data URL', async () => {
      const base64Data = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const res = await services.call('media.upload', {
        base64: base64Data,
        originalName: 'dot.png',
      });

      expect(res.publicUrl).toBeDefined();
      expect(res.key.endsWith('.png')).toBe(true);
      expect(res.mimeType).toBe('image/png');
      expect(res.size).toBeGreaterThan(0);
    });

    it('should upload file from filePath', async () => {
      const sampleFile = path.join(tmpDir, 'sample-source.json');
      await fs.writeFile(sampleFile, JSON.stringify({ test: true }), 'utf-8');

      const res = await services.call('media.upload', {
        filePath: sampleFile,
        mimeType: 'application/json',
      });

      expect(res.publicUrl).toBeDefined();
      expect(res.key.endsWith('.json')).toBe(true);
      expect(res.originalName).toBe('sample-source.json');
    });

    it('should reject when no content is provided', async () => {
      await expect(
        services.call('media.upload', {})
      ).rejects.toThrow();
    });
  });

  describe('media.info & media.delete', () => {
    it('should return info for existing file and delete it', async () => {
      const buffer = Buffer.from('To be deleted');
      const uploaded = await services.call('media.upload', {
        buffer,
        originalName: 'test.txt',
      });

      // Check info
      const info = await services.call('media.info', { key: uploaded.key });
      expect(info.exists).toBe(true);
      expect(info.size).toBe(buffer.length);
      expect(info.ext).toBe('.txt');

      // Delete file
      const del = await services.call('media.delete', { key: uploaded.key });
      expect(del.success).toBe(true);

      // Check info again
      const afterInfo = await services.call('media.info', { key: uploaded.key });
      expect(afterInfo.exists).toBe(false);
    });

    it('should block directory traversal attempt in delete and info', async () => {
      await expect(
        services.call('media.delete', { key: '../../../etc/passwd' })
      ).rejects.toThrow();

      await expect(
        services.call('media.info', { key: '../../sensitive.key' })
      ).rejects.toThrow();
    });
  });

  describe('uploadPlugin automatic registration', () => {
    it('should auto-register media.* services into serviceRegistry when uploadPlugin is used in createApp', async () => {
      const { app } = createApp({
        pagesDir: path.join(__dirname, '../fixtures/pages'),
        plugins: [
          uploadPlugin({
            local: { destDir: tmpDir, publicBasePath: '/uploads' },
          }),
        ],
      });

      expect(app.serviceRegistry.has('media.upload')).toBe(true);
      expect(app.serviceRegistry.has('media.delete')).toBe(true);
      expect(app.serviceRegistry.has('media.info')).toBe(true);

      const res = await app.serviceRegistry.call('media.upload', {
        buffer: Buffer.from('Auto Upload'),
        originalName: 'auto.txt',
      });

      expect(res.publicUrl).toBeDefined();
      expect(res.size).toBe(11);
    });
  });

  describe('media.* edge cases & branch coverage', () => {
    it('should cover string buffer, invalid buffer, missing filePath, and non-existent delete', async () => {
      // 1. String buffer
      const strRes = await services.call('media.upload', {
        buffer: 'raw text content',
        originalName: 'raw.txt',
      });
      expect(strRes.size).toBe(16);

      // 2. Invalid buffer type
      await expect(
        services.call('media.upload', { buffer: 12345 })
      ).rejects.toThrow('Invalid buffer provided');

      // 3. Missing filePath
      await expect(
        services.call('media.upload', { filePath: '/non/existent/image.png' })
      ).rejects.toThrow('Source file not found');

      // 4. Delete non-existent file
      const delMissing = await services.call('media.delete', { key: 'non-existent-file.txt' });
      expect(delMissing.success).toBe(false);
      expect(delMissing.message).toBe('File not found');

      // 5. Upload with custom destDir and publicBasePath
      const customSub = path.join(tmpDir, 'custom-sub');
      const customRes = await services.call('media.upload', {
        buffer: Buffer.from('custom'),
        destDir: customSub,
        publicBasePath: '/custom-base',
        originalName: 'custom.txt',
      });
      expect(customRes.publicUrl.startsWith('/custom-base/')).toBe(true);
    });
  });
});

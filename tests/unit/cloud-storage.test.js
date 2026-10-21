import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const request = require('supertest');

const {
  uploadPlugin,
  createS3FileProvider,
  createGcsFileProvider,
} = require('../../plugins/upload');

const {
  collectAssetFiles,
  determineCacheControl,
  detectProvider,
  lookupMime,
} = require('../../bin/commands/assets-sync');

describe('Cloud Storage Providers (S3, GCS & Presigned Direct Upload)', () => {
  // ========================================================
  // 1. Google Cloud Storage Provider (createGcsFileProvider)
  // ========================================================
  describe('Google Cloud Storage Provider (createGcsFileProvider)', () => {
    it('initializes GCS provider and validates bucket', () => {
      expect(() => createGcsFileProvider({})).toThrow(/GCS Bucket/);

      const provider = createGcsFileProvider({
        bucket: 'my-gcs-bucket',
        publicBaseUrl: 'https://cdn.example.com',
        prefix: 'user-media',
      });

      expect(provider.bucketName).toBe('my-gcs-bucket');
      expect(provider.publicBaseUrl).toBe('https://cdn.example.com');
    });

    it('uploads files to GCS bucket instance via .put()', async () => {
      const savedFiles = new Map();

      const mockBucket = {
        name: 'my-gcs-bucket',
        file(key) {
          return {
            async save(buffer, options) {
              savedFiles.set(key, { buffer, options });
            },
          };
        },
      };

      const provider = createGcsFileProvider({
        bucket: mockBucket,
        prefix: 'avatars',
      });

      const res = await provider.put({
        buffer: Buffer.from('gcs-image-data'),
        originalName: 'profile.png',
        mimeType: 'image/png',
      });

      expect(res.key.startsWith('avatars/')).toBe(true);
      expect(res.key.endsWith('.png')).toBe(true);
      expect(res.publicUrl).toBe(`https://storage.googleapis.com/my-gcs-bucket/${res.key}`);
      expect(savedFiles.has(res.key)).toBe(true);

      const saved = savedFiles.get(res.key);
      expect(saved.options.metadata.contentType).toBe('image/png');
      expect(saved.options.metadata.metadata.originalName).toBe('profile.png');
    });

    it('deletes files from GCS bucket via .delete()', async () => {
      let deletedKey = null;

      const mockBucket = {
        name: 'my-gcs-bucket',
        file(key) {
          return {
            async delete() {
              deletedKey = key;
              return true;
            },
          };
        },
      };

      const provider = createGcsFileProvider({ bucket: mockBucket });
      const success = await provider.delete('avatars/pic.jpg');

      expect(success).toBe(true);
      expect(deletedKey).toBe('avatars/pic.jpg');
    });

    it('generates V4 signed upload URLs for direct browser-to-GCS upload', async () => {
      const mockBucket = {
        name: 'my-gcs-bucket',
        file(key) {
          return {
            async getSignedUrl(cfg) {
              return [`https://storage.googleapis.com/my-gcs-bucket/${key}?X-Goog-Signature=mock123`, cfg];
            },
          };
        },
      };

      const provider = createGcsFileProvider({
        bucket: mockBucket,
        prefix: 'uploads',
      });

      const presign = await provider.createSignedUploadUrl({
        originalName: 'document.pdf',
        mimeType: 'application/pdf',
      });

      expect(presign.uploadUrl).toContain('https://storage.googleapis.com/my-gcs-bucket/uploads/');
      expect(presign.uploadUrl).toContain('X-Goog-Signature=mock123');
      expect(presign.publicUrl).toBe(`https://storage.googleapis.com/my-gcs-bucket/${presign.key}`);
      expect(presign.method).toBe('PUT');
      expect(presign.headers['Content-Type']).toBe('application/pdf');
    });
  });

  // ========================================================
  // 2. S3 Direct Presigned URL Generation
  // ========================================================
  describe('S3 Provider Direct Presigned URLs', () => {
    it('creates presigned upload URL using duck-typed s3Client.getSignedUrl', async () => {
      const mockS3Client = {
        send: vi.fn(),
        async getSignedUrl(action, params) {
          return `https://s3.amazonaws.com/${params.Bucket}/${params.Key}?X-Amz-Signature=mockSig`;
        },
      };

      const provider = createS3FileProvider({
        s3Client: mockS3Client,
        bucket: 'prod-s3-bucket',
        prefix: 'attachments',
      });

      const result = await provider.createSignedUploadUrl({
        originalName: 'invoice.pdf',
        mimeType: 'application/pdf',
      });

      expect(result.uploadUrl).toContain('https://s3.amazonaws.com/prod-s3-bucket/attachments/');
      expect(result.uploadUrl).toContain('X-Amz-Signature=mockSig');
      expect(result.publicUrl).toContain('https://prod-s3-bucket.s3.amazonaws.com/attachments/');
      expect(result.method).toBe('PUT');
      expect(result.headers['Content-Type']).toBe('application/pdf');
    });

    it('creates presigned upload URL using custom createSignedUrl callback', async () => {
      const mockS3Client = { send: vi.fn() };

      const provider = createS3FileProvider({
        s3Client: mockS3Client,
        bucket: 'my-custom-bucket',
        publicBaseUrl: 'https://cdn.example.com',
        prefix: 'videos',
        createSignedUrl: async ({ bucket, key, mimeType }) => {
          return `https://${bucket}.example.com/${key}?signed=true&mime=${mimeType}`;
        },
      });

      const result = await provider.createSignedUploadUrl({
        originalName: 'clip.mp4',
        mimeType: 'video/mp4',
      });

      expect(result.uploadUrl).toContain('my-custom-bucket.example.com/videos/');
      expect(result.uploadUrl).toContain('signed=true');
      expect(result.publicUrl.startsWith('https://cdn.example.com/videos/')).toBe(true);
      expect(result.key.endsWith('.mp4')).toBe(true);
    });
  });

  // ========================================================
  // 3. uploadPlugin with presigned: true endpoint
  // ========================================================
  describe('uploadPlugin Direct Presigned Endpoint', () => {
    it('mounts POST /api/upload/presign and returns presigned URL data', async () => {
      const app = express();
      app.use(express.json());

      const mockProvider = {
        async put() {
          return { publicUrl: '/dummy' };
        },
        async createSignedUploadUrl({ originalName, mimeType }) {
          return {
            uploadUrl: `https://mock-storage.com/${originalName}?signature=xyz`,
            publicUrl: `https://cdn.mock-storage.com/${originalName}`,
            key: `uploads/${originalName}`,
            method: 'PUT',
            headers: { 'Content-Type': mimeType },
          };
        },
      };

      const plugin = uploadPlugin({
        path: '/api/upload',
        provider: mockProvider,
        presigned: true,
      });

      const ctx = {
        addRoute(method, routePath, ...handlers) {
          app[method](routePath, ...handlers);
        },
      };

      plugin.register(ctx);

      // 1. Missing originalName should return 400
      const badReq = await request(app).post('/api/upload/presign').send({});
      expect(badReq.status).toBe(400);
      expect(badReq.body.error).toContain('originalName is required');

      // 2. Valid request returns upload credentials
      const res = await request(app).post('/api/upload/presign').send({
        originalName: 'report.pdf',
        mimeType: 'application/pdf',
      });

      expect(res.status).toBe(200);
      expect(res.body.uploadUrl).toContain('https://mock-storage.com/report.pdf');
      expect(res.body.publicUrl).toBe('https://cdn.mock-storage.com/report.pdf');
      expect(res.body.method).toBe('PUT');
      expect(res.body.headers['Content-Type']).toBe('application/pdf');
    });

    it('returns 400 if provider does not support presigned uploads', async () => {
      const app = express();
      app.use(express.json());

      const simpleProvider = {
        async put() {
          return { publicUrl: '/local/file.txt' };
        },
      };

      const plugin = uploadPlugin({
        provider: simpleProvider,
        presigned: true,
      });

      plugin.register({
        addRoute(method, routePath, ...handlers) {
          app[method](routePath, ...handlers);
        },
      });

      const res = await request(app).post('/api/upload/presign').send({
        originalName: 'foo.txt',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('does not support direct presigned uploads');
    });
  });

  // ========================================================
  // 4. Static Asset Sync Helpers (assets:sync)
  // ========================================================
  describe('Static Asset Sync (assets:sync CLI helpers)', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webspresso-assets-test-'));
    });

    afterEach(() => {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('determines MIME types accurately', () => {
      expect(lookupMime('app.js')).toBe('application/javascript; charset=utf-8');
      expect(lookupMime('styles.css')).toBe('text/css; charset=utf-8');
      expect(lookupMime('font.woff2')).toBe('font/woff2');
      expect(lookupMime('image.webp')).toBe('image/webp');
      expect(lookupMime('unknown.xyz')).toBe('application/octet-stream');
    });

    it('applies immutable cache-control for content-hashed assets', () => {
      expect(determineCacheControl('assets/app.a1b2c3d4e5.js')).toBe('public, max-age=31536000, immutable');
      expect(determineCacheControl('styles.87654321.css')).toBe('public, max-age=31536000, immutable');
      expect(determineCacheControl('manifest.json')).toBe('public, max-age=3600, must-revalidate');
      expect(determineCacheControl('favicon.ico')).toBe('public, max-age=3600, must-revalidate');
      expect(determineCacheControl('any.js', 'custom-header')).toBe('custom-header');
    });

    it('detects cloud providers from flags and environment variables', () => {
      expect(detectProvider({ provider: 'gcs' })).toBe('gcs');
      expect(detectProvider({ provider: 'r2' })).toBe('r2');
      expect(detectProvider({ provider: 's3' })).toBe('s3');

      expect(detectProvider({}, { GCS_BUCKET: 'my-gcs' })).toBe('gcs');
      expect(detectProvider({}, { R2_BUCKET: 'my-r2' })).toBe('r2');
      expect(detectProvider({}, { AWS_S3_BUCKET: 'my-s3' })).toBe('s3');
    });

    it('recursively collects static assets and metadata', () => {
      const cssDir = path.join(tmpDir, 'css');
      fs.mkdirSync(cssDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'index.html'), '<h1>Hello</h1>', 'utf8');
      fs.writeFileSync(path.join(cssDir, 'theme.a1b2c3d4.css'), 'body { color: red; }', 'utf8');

      const collected = collectAssetFiles(tmpDir);

      expect(collected).toHaveLength(2);
      const htmlFile = collected.find((f) => f.relativePath === 'index.html');
      const cssFile = collected.find((f) => f.relativePath === 'css/theme.a1b2c3d4.css');

      expect(htmlFile).toBeDefined();
      expect(htmlFile.mimeType).toBe('text/html; charset=utf-8');
      expect(htmlFile.cacheControl).toContain('must-revalidate');

      expect(cssFile).toBeDefined();
      expect(cssFile.mimeType).toBe('text/css; charset=utf-8');
      expect(cssFile.cacheControl).toBe('public, max-age=31536000, immutable');
    });
  });
});

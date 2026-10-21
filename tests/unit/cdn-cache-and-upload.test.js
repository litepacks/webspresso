'use strict';

/**
 * Unit Tests for Edge CDN Caching & R2/S3 Upload Providers
 * Tests:
 * 1. buildCdnCacheHeaders & setCdnCache (RFC-9211 Cache-Control, Cache-Tag, SWR)
 * 2. CdnPurgeClient (Cloudflare, Fastly, Mock, Custom)
 * 3. bindOrmCdnPurge (ORM model mutation hook -> CDN tag invalidation)
 * 4. createR2FileProvider (Cloudflare Workers R2 Bucket binding)
 * 5. createS3FileProvider (Generic S3 client)
 */

const {
  buildCdnCacheHeaders,
  setCdnCache,
  createCdnPurgeClient,
  bindOrmCdnPurge,
} = require('../../core/cache/cdn');
const {
  createR2FileProvider,
  createS3FileProvider,
  generateStorageKey,
} = require('../../plugins/upload/s3-provider');

describe('Edge CDN Caching & Tag Invalidation (core/cache/cdn)', () => {
  it('builds RFC-compliant Cache-Control and Cache-Tag headers', () => {
    const headers = buildCdnCacheHeaders({
      maxAge: 60,
      sMaxAge: '1h',
      staleWhileRevalidate: '1d',
      staleIfError: '7d',
      tags: ['jobs', 'job-42'],
      public: true,
    });

    expect(headers['Cache-Control']).toBe('public, max-age=60, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=604800');
    expect(headers['Cache-Tag']).toBe('jobs,job-42');
    expect(headers['Surrogate-Key']).toBe('jobs job-42');
  });

  it('sets headers on response object via setCdnCache', () => {
    const resHeaders = {};
    const mockRes = {
      setHeader(k, v) {
        resHeaders[k] = v;
      },
    };

    setCdnCache(mockRes, {
      maxAge: '5m',
      sMaxAge: '2h',
      tags: ['blog-post', 'author-7'],
    });

    expect(resHeaders['Cache-Control']).toContain('max-age=300');
    expect(resHeaders['Cache-Control']).toContain('s-maxage=7200');
    expect(resHeaders['Cache-Tag']).toBe('blog-post,author-7');
  });

  it('handles private and immutable cache directives correctly', () => {
    const headers = buildCdnCacheHeaders({
      private: true,
      maxAge: 0,
      mustRevalidate: true,
      immutable: true,
    });

    expect(headers['Cache-Control']).toBe('private, max-age=0, must-revalidate, immutable');
    expect(headers['Cache-Tag']).toBeUndefined();
  });

  it('purges cache tags via CdnPurgeClient (mock provider)', async () => {
    const client = createCdnPurgeClient({ provider: 'mock' });

    const res = await client.purgeTags(['job-42', 'jobs']);
    expect(res.success).toBe(true);
    expect(res.count).toBe(2);
    expect(client.purgedHistory.length).toBe(1);
    expect(client.purgedHistory[0].tags).toEqual(['job-42', 'jobs']);
  });

  it('purges cache tags via custom purge function', async () => {
    let captured = null;
    const client = createCdnPurgeClient({
      provider: 'custom',
      purge: async ({ tags }) => {
        captured = tags;
        return { customStatus: 200 };
      },
    });

    const res = await client.purgeTags(['test-tag']);
    expect(res.success).toBe(true);
    expect(captured).toEqual(['test-tag']);
  });

  it('automatically purges CDN tags on ORM model update and delete via bindOrmCdnPurge', async () => {
    const client = createCdnPurgeClient({ provider: 'mock' });

    // Mock database model
    const mockModel = {
      name: 'Job',
      hooks: {},
    };

    const mockDb = {
      getModel: (name) => (name === 'Job' ? mockModel : null),
    };

    bindOrmCdnPurge(mockDb, {
      modelTags: {
        Job: (record) => [`job-${record.id}`, 'jobs'],
      },
      client,
    });

    // Simulate afterUpdate hook
    await mockModel.hooks.afterUpdate({ id: 101, title: 'Senior Dev' });
    expect(client.purgedHistory.length).toBe(1);
    expect(client.purgedHistory[0].tags).toEqual(['job-101', 'jobs']);

    // Simulate afterDelete hook
    await mockModel.hooks.afterDelete({ id: 101 });
    expect(client.purgedHistory.length).toBe(2);
    expect(client.purgedHistory[1].tags).toEqual(['job-101', 'jobs']);
  });
});

describe('Cloudflare R2 & S3 Upload Providers (plugins/upload/s3-provider)', () => {
  it('generates unique storage keys with sanitized extensions', () => {
    const key = generateStorageKey('My Resume.PDF', 'application/pdf', 'resumes');
    expect(key.startsWith('resumes/')).toBe(true);
    expect(key.endsWith('.pdf')).toBe(true);
  });

  it('stores and deletes files using native Cloudflare R2 bucket binding', async () => {
    const r2Store = new Map();
    const mockR2Bucket = {
      async put(key, buffer, opts) {
        r2Store.set(key, { buffer, opts });
        return { key };
      },
      async delete(key) {
        return r2Store.delete(key);
      },
    };

    const provider = createR2FileProvider({
      bucket: mockR2Bucket,
      publicBaseUrl: 'https://cdn.example.com',
      prefix: 'media',
    });

    const uploadResult = await provider.put({
      buffer: Buffer.from('hello-image'),
      originalName: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 11,
    });

    expect(uploadResult.key.startsWith('media/')).toBe(true);
    expect(uploadResult.key.endsWith('.jpg')).toBe(true);
    expect(uploadResult.publicUrl.startsWith('https://cdn.example.com/media/')).toBe(true);
    expect(r2Store.has(uploadResult.key)).toBe(true);

    const r2Entry = r2Store.get(uploadResult.key);
    expect(r2Entry.opts.httpMetadata.contentType).toBe('image/jpeg');

    // Delete
    const deleted = await provider.delete(uploadResult.key);
    expect(deleted).toBe(true);
    expect(r2Store.has(uploadResult.key)).toBe(false);
  });

  it('stores and deletes files using S3 provider with s3Client.send()', async () => {
    const sentCommands = [];
    const mockS3Client = {
      async send(command) {
        sentCommands.push(command);
        return {};
      },
    };

    const provider = createS3FileProvider({
      s3Client: mockS3Client,
      bucket: 'my-s3-bucket',
      publicBaseUrl: 'https://s3.example.com/my-s3-bucket',
      prefix: 'docs',
    });

    const uploadResult = await provider.put({
      buffer: Buffer.from('pdf-content'),
      originalName: 'invoice.pdf',
      mimeType: 'application/pdf',
      size: 11,
    });

    expect(uploadResult.publicUrl.startsWith('https://s3.example.com/my-s3-bucket/docs/')).toBe(true);
    expect(sentCommands.length).toBe(1);
    expect(sentCommands[0].input.Bucket).toBe('my-s3-bucket');
    expect(sentCommands[0].input.ContentType).toBe('application/pdf');

    // Delete
    const deleted = await provider.delete(uploadResult.key);
    expect(deleted).toBe(true);
    expect(sentCommands.length).toBe(2);
  });

  it('fails fast if bucket is missing in createR2FileProvider', () => {
    expect(() => createR2FileProvider({})).toThrow(/R2 Bucket binding/);
  });

  it('fails fast if s3Client is missing in createS3FileProvider', () => {
    expect(() => createS3FileProvider({ bucket: 'test' })).toThrow(/S3 client instance/);
  });
});

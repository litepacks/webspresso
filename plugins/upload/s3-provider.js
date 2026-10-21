/**
 * S3 & Cloudflare R2 Upload Storage Providers for Webspresso
 * Enables direct file storage in Cloudflare R2 (Worker bindings or S3 API) and AWS S3/MinIO
 * @module plugins/upload/s3-provider
 */

'use strict';

const path = require('path');
const { randomBytes } = require('crypto');
const { resolveStoredExtension } = require('./local-file-provider');

/**
 * Generate a secure, unique object storage key
 * @param {string} originalName
 * @param {string} mimeType
 * @param {string} [prefix='']
 * @returns {string}
 */
function generateStorageKey(originalName, mimeType, prefix = '') {
  const base = path.basename(originalName || 'upload');
  let ext = path.extname(base).toLowerCase();
  if (!/^\.[a-z0-9]{1,12}$/.test(ext)) {
    ext = '';
  }
  ext = resolveStoredExtension(mimeType, ext);

  const cleanPrefix = prefix ? prefix.replace(/^\/+|\/+$/g, '') + '/' : '';
  const uniqueName = `${Date.now()}-${randomBytes(8).toString('hex')}${ext}`;
  return `${cleanPrefix}${uniqueName}`;
}

/**
 * Cloudflare R2 Native Worker Storage Provider
 * Zero-dependency: interacts directly with Cloudflare Workers R2Bucket binding (env.BUCKET)
 * @param {Object} options
 * @param {Object} options.bucket - Cloudflare R2 Bucket binding (e.g. env.BUCKET)
 * @param {string} options.publicBaseUrl - Public CDN or R2 custom domain URL (e.g. 'https://cdn.example.com')
 * @param {string} [options.prefix='uploads'] - Directory prefix inside bucket
 * @returns {import('./index').UploadStorageProvider}
 */
function createR2FileProvider(options = {}) {
  const { bucket, publicBaseUrl, prefix = 'uploads' } = options;

  if (!bucket) {
    throw new Error('[createR2FileProvider] R2 Bucket binding (env.BUCKET) is required.');
  }

  const normalizedBaseUrl = (publicBaseUrl || '').replace(/\/+$/, '');

  return {
    /**
     * Store file in Cloudflare R2
     */
    async put({ buffer, originalName, mimeType, size, req }) {
      void size;
      void req;

      const key = generateStorageKey(originalName, mimeType, prefix);

      if (typeof bucket.put !== 'function') {
        throw new Error('[createR2FileProvider] Provided bucket binding does not implement .put() method.');
      }

      await bucket.put(key, buffer, {
        httpMetadata: {
          contentType: mimeType || 'application/octet-stream',
        },
        customMetadata: {
          originalName: originalName || '',
          uploadedAt: new Date().toISOString(),
        },
      });

      const publicUrl = normalizedBaseUrl ? `${normalizedBaseUrl}/${key}` : `/${key}`;
      return { publicUrl, key };
    },

    /**
     * Delete file from Cloudflare R2
     * @param {string} key
     */
    async delete(key) {
      if (typeof bucket.delete === 'function') {
        await bucket.delete(key);
        return true;
      }
      return false;
    },
  };
}

/**
 * Generic S3 Storage Provider (AWS S3, MinIO, or S3-compatible R2)
 * @param {Object} options
 * @param {Object} options.s3Client - S3 Client instance (e.g. @aws-sdk/client-s3 S3Client)
 * @param {string} options.bucket - Bucket name
 * @param {string} [options.publicBaseUrl] - Public CDN / bucket base URL
 * @param {string} [options.prefix='uploads'] - Key prefix
 * @returns {import('./index').UploadStorageProvider}
 */
function createS3FileProvider(options = {}) {
  const { s3Client, bucket, publicBaseUrl, prefix = 'uploads' } = options;

  if (!s3Client || typeof s3Client.send !== 'function') {
    throw new Error('[createS3FileProvider] An S3 client instance with a .send() method is required.');
  }
  if (!bucket) {
    throw new Error('[createS3FileProvider] Bucket name is required.');
  }

  const normalizedBaseUrl = (publicBaseUrl || '').replace(/\/+$/, '');

  return {
    async put({ buffer, originalName, mimeType, size, req }) {
      void size;
      void req;

      const key = generateStorageKey(originalName, mimeType, prefix);

      // Dynamically load PutObjectCommand or construct Command payload
      let command;
      try {
        const { PutObjectCommand } = require('@aws-sdk/client-s3');
        command = new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: mimeType || 'application/octet-stream',
        });
      } catch (_) {
        // Fallback for custom or duck-typed S3 client wrappers
        command = {
          constructor: { name: 'PutObjectCommand' },
          input: {
            Bucket: bucket,
            Key: key,
            Body: buffer,
            ContentType: mimeType || 'application/octet-stream',
          },
        };
      }

      await s3Client.send(command);

      const publicUrl = normalizedBaseUrl ? `${normalizedBaseUrl}/${key}` : `/${key}`;
      return { publicUrl, key };
    },

    async delete(key) {
      try {
        const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        await s3Client.send(new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        }));
        return true;
      } catch (_) {
        return false;
      }
    },

    /**
     * Generate a signed PUT URL for direct browser-to-S3 client upload
     * @param {Object} [params]
     * @param {string} [params.originalName]
     * @param {string} [params.mimeType]
     * @param {number} [params.expiresInSeconds=900] - 15 minutes default
     * @param {string} [params.key] - Custom key override
     * @returns {Promise<{ uploadUrl: string, publicUrl: string, key: string, method: string, headers: Record<string, string> }>}
     */
    async createSignedUploadUrl(params = {}) {
      const {
        originalName = 'upload',
        mimeType = 'application/octet-stream',
        expiresInSeconds = 900,
        key: customKey,
      } = params;

      const key = customKey || generateStorageKey(originalName, mimeType, prefix);
      const publicUrl = normalizedBaseUrl ? `${normalizedBaseUrl}/${key}` : `https://${bucket}.s3.amazonaws.com/${key}`;

      // 1. Duck-typed client with direct getSignedUrl method (e.g. AWS SDK v2, MinIO, or mock)
      if (typeof s3Client.getSignedUrl === 'function') {
        const uploadUrl = await s3Client.getSignedUrl('putObject', {
          Bucket: bucket,
          Key: key,
          ContentType: mimeType,
          Expires: expiresInSeconds,
        });
        return {
          uploadUrl,
          publicUrl,
          key,
          method: 'PUT',
          headers: { 'Content-Type': mimeType },
        };
      }

      // 2. Custom signer function option
      if (typeof options.createSignedUrl === 'function') {
        const uploadUrl = await options.createSignedUrl({ bucket, key, mimeType, expiresInSeconds });
        return {
          uploadUrl,
          publicUrl,
          key,
          method: 'PUT',
          headers: { 'Content-Type': mimeType },
        };
      }

      // 3. AWS SDK v3 with @aws-sdk/s3-request-presigner
      try {
        const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
        const { PutObjectCommand } = require('@aws-sdk/client-s3');
        const uploadUrl = await getSignedUrl(
          s3Client,
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            ContentType: mimeType,
          }),
          { expiresIn: expiresInSeconds }
        );
        return {
          uploadUrl,
          publicUrl,
          key,
          method: 'PUT',
          headers: { 'Content-Type': mimeType },
        };
      } catch (err) {
        throw new Error(
          `[createS3FileProvider] Direct signed upload requires @aws-sdk/s3-request-presigner or a mock client with getSignedUrl: ${err.message}`
        );
      }
    },
  };
}

module.exports = {
  createR2FileProvider,
  createS3FileProvider,
  generateStorageKey,
};

/**
 * Google Cloud Storage (GCS) File Provider for Webspresso
 * Enables direct file storage, streaming, and signed upload URLs with Google Cloud Storage
 * Zero-dependency compatible: supports official @google-cloud/storage or standard duck-typed client interfaces
 * @module plugins/upload/gcs-provider
 */

'use strict';

const { generateStorageKey } = require('./s3-provider');

/**
 * Google Cloud Storage Provider
 * @param {Object} options
 * @param {Object|string} options.bucket - GCS Bucket name (string) or Bucket instance (e.g. storage.bucket('my-bucket'))
 * @param {Object} [options.storageClient] - Optional Storage instance from @google-cloud/storage
 * @param {string} [options.publicBaseUrl] - Custom public domain or CDN URL (e.g. 'https://cdn.example.com')
 * @param {string} [options.prefix='uploads'] - Subdirectory prefix inside the GCS bucket
 * @returns {Object} Upload storage provider implementing put, delete, and createSignedUploadUrl
 */
function createGcsFileProvider(options = {}) {
  const { storageClient, publicBaseUrl, prefix = 'uploads' } = options;
  let bucket = options.bucket;

  if (!bucket) {
    throw new Error('[createGcsFileProvider] GCS Bucket (name string or Bucket object) is required.');
  }

  const bucketName = typeof bucket === 'string' ? bucket : (bucket.name || 'bucket');
  let bucketInstance = typeof bucket === 'object' && bucket !== null ? bucket : null;

  if (typeof bucket === 'string' && storageClient && typeof storageClient.bucket === 'function') {
    bucketInstance = storageClient.bucket(bucket);
  }

  const defaultBaseUrl = `https://storage.googleapis.com/${bucketName}`;
  const normalizedBaseUrl = (publicBaseUrl || defaultBaseUrl).replace(/\/+$/, '');

  return {
    bucketName,
    publicBaseUrl: normalizedBaseUrl,

    /**
     * Store file in Google Cloud Storage
     * @param {Object} args
     * @param {Buffer} args.buffer
     * @param {string} args.originalName
     * @param {string} args.mimeType
     * @returns {Promise<{ publicUrl: string, key: string }>}
     */
    async put({ buffer, originalName, mimeType }) {
      const key = generateStorageKey(originalName, mimeType, prefix);

      if (bucketInstance && typeof bucketInstance.file === 'function') {
        const file = bucketInstance.file(key);
        await file.save(buffer, {
          metadata: {
            contentType: mimeType || 'application/octet-stream',
            metadata: {
              originalName: originalName || '',
              uploadedAt: new Date().toISOString(),
            },
          },
          resumable: false,
        });
      } else {
        throw new Error(
          '[createGcsFileProvider] A valid GCS bucket instance with .file() is required to perform .put().'
        );
      }

      const publicUrl = `${normalizedBaseUrl}/${key}`;
      return { publicUrl, key };
    },

    /**
     * Delete file from Google Cloud Storage
     * @param {string} key
     * @returns {Promise<boolean>}
     */
    async delete(key) {
      if (bucketInstance && typeof bucketInstance.file === 'function') {
        const file = bucketInstance.file(key);
        try {
          if (typeof file.delete === 'function') {
            await file.delete({ ignoreNotFound: true });
            return true;
          }
        } catch (_) {
          return false;
        }
      }
      return false;
    },

    /**
     * Generate a V4 signed URL for direct browser-to-GCS upload
     * @param {Object} [params]
     * @param {string} [params.originalName]
     * @param {string} [params.mimeType]
     * @param {number} [params.expiresInMs=900000] - 15 minutes default
     * @param {string} [params.key] - Custom key override
     * @returns {Promise<{ uploadUrl: string, publicUrl: string, key: string, method: string, headers: Record<string, string> }>}
     */
    async createSignedUploadUrl(params = {}) {
      const {
        originalName = 'upload',
        mimeType = 'application/octet-stream',
        expiresInMs = 15 * 60 * 1000,
        key: customKey,
      } = params;

      const key = customKey || generateStorageKey(originalName, mimeType, prefix);

      if (!bucketInstance || typeof bucketInstance.file !== 'function') {
        throw new Error('[createGcsFileProvider] GCS bucket instance required for generating signed upload URLs.');
      }

      const file = bucketInstance.file(key);
      if (typeof file.getSignedUrl !== 'function') {
        throw new Error('[createGcsFileProvider] file.getSignedUrl() method is not implemented on GCS File instance.');
      }

      const [signedUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + expiresInMs,
        contentType: mimeType,
      });

      const publicUrl = `${normalizedBaseUrl}/${key}`;

      return {
        uploadUrl: signedUrl,
        publicUrl,
        key,
        method: 'PUT',
        headers: {
          'Content-Type': mimeType,
        },
      };
    },
  };
}

module.exports = {
  createGcsFileProvider,
};

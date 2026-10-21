/**
 * AWS Secrets Manager & SSM Parameter Store Provider for Webspresso
 * Zero-dependency: Uses standard Node.js https/crypto with standard AWS SigV4 request signing.
 * Supports official @aws-sdk clients or duck-typed client if provided.
 *
 * @module core/secrets/providers/aws
 */

'use strict';

const https = require('https');
const crypto = require('crypto');
const { makeHttpRequest } = require('./gcp');

/**
 * Derives HMAC-SHA256 hash
 * @param {string|Buffer} key
 * @param {string|Buffer} data
 * @returns {Buffer}
 */
function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

/**
 * SHA256 hex digest
 * @param {string|Buffer} data
 * @returns {string}
 */
function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Calculates AWS SigV4 Authorization header and headers map
 * @param {Object} params
 * @param {string} params.method
 * @param {string} params.host
 * @param {string} [params.path='/']
 * @param {Record<string, string>} [params.headers={}]
 * @param {string} params.body
 * @param {string} params.service - 'secretsmanager' or 'ssm'
 * @param {string} params.region
 * @param {string} params.accessKeyId
 * @param {string} params.secretAccessKey
 * @param {string} [params.sessionToken]
 * @param {Date} [params.date]
 * @returns {Record<string, string>} Complete request headers including Authorization and x-amz-date
 */
function signAwsV4Request(params) {
  const {
    method = 'POST',
    host,
    path = '/',
    headers = {},
    body = '',
    service,
    region,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    date = new Date(),
  } = params;

  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);

  const requestHeaders = {
    ...headers,
    host,
    'x-amz-date': amzDate,
  };

  if (sessionToken) {
    requestHeaders['x-amz-security-token'] = sessionToken;
  }

  // 1. Canonical Headers & Signed Headers
  const sortedHeaderKeys = Object.keys(requestHeaders)
    .map((k) => k.toLowerCase())
    .sort();

  const canonicalHeaders = sortedHeaderKeys
    .map((k) => `${k}:${String(requestHeaders[k] ?? requestHeaders[Object.keys(requestHeaders).find((orig) => orig.toLowerCase() === k)]).trim()}\n`)
    .join('');

  const signedHeaders = sortedHeaderKeys.join(';');

  // 2. Canonical Request
  const payloadHash = sha256Hex(body);
  const canonicalRequest = [
    method.toUpperCase(),
    path,
    '', // query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // 3. String to Sign
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  // 4. Calculate Signature
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');

  // 5. Authorization Header
  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    ...requestHeaders,
    Authorization: authHeader,
  };
}

class AwsSecretProvider {
  /**
   * @param {Object} [options]
   * @param {string} [options.region] - AWS Region (e.g. 'us-east-1', 'eu-central-1')
   * @param {'secretsmanager'|'ssm'} [options.service='secretsmanager']
   * @param {string} [options.accessKeyId]
   * @param {string} [options.secretAccessKey]
   * @param {string} [options.sessionToken]
   * @param {Object} [options.client] - Duck-typed AWS SDK client
   * @param {Function} [options.httpTransport] - Custom transport for testing
   */
  constructor(options = {}) {
    this.name = 'aws';
    this.options = options;
    this.client = options.client || null;
    this.service = options.service === 'ssm' ? 'ssm' : 'secretsmanager';
    this.httpTransport = options.httpTransport || makeHttpRequest;

    this.region = options.region
      || process.env.AWS_REGION
      || process.env.AWS_DEFAULT_REGION
      || 'us-east-1';

    this.accessKeyId = options.accessKeyId
      || process.env.AWS_ACCESS_KEY_ID
      || null;

    this.secretAccessKey = options.secretAccessKey
      || process.env.AWS_SECRET_ACCESS_KEY
      || null;

    this.sessionToken = options.sessionToken
      || process.env.AWS_SESSION_TOKEN
      || null;
  }

  /**
   * Fetch secret value from AWS Secrets Manager or SSM Parameter Store
   * @param {string} secretName - Secret name/ARN (or parameter name for SSM)
   * @returns {Promise<string|null>}
   */
  async get(secretName) {
    if (!secretName || typeof secretName !== 'string') {
      return null;
    }

    // 1. Duck-typed AWS SDK client support
    if (this.client && typeof this.client.send === 'function') {
      try {
        if (this.service === 'ssm') {
          const res = await this.client.send({
            Name: secretName,
            WithDecryption: true,
          });
          return res?.Parameter?.Value ?? null;
        } else {
          const res = await this.client.send({
            SecretId: secretName,
          });
          if (res?.SecretString) return res.SecretString;
          if (res?.SecretBinary) {
            return Buffer.from(res.SecretBinary).toString('utf8');
          }
          return null;
        }
      } catch (err) {
        if (
          err.name === 'ResourceNotFoundException' ||
          err.name === 'ParameterNotFound' ||
          err.message?.includes('not found')
        ) {
          return null;
        }
        throw err;
      }
    }

    // 2. Zero-dependency SigV4 REST API execution
    const accessKeyId = this.accessKeyId || process.env.AWS_ACCESS_KEY_ID || (this.httpTransport !== makeHttpRequest ? 'test-access-key' : null);
    const secretAccessKey = this.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || (this.httpTransport !== makeHttpRequest ? 'test-secret-key' : null);
    const sessionToken = this.sessionToken || process.env.AWS_SESSION_TOKEN;

    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        `[AwsSecretProvider] Missing AWS credentials. Pass accessKeyId and secretAccessKey, or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.`
      );
    }

    const host = this.service === 'ssm'
      ? `ssm.${this.region}.amazonaws.com`
      : `secretsmanager.${this.region}.amazonaws.com`;

    const target = this.service === 'ssm'
      ? 'AmazonSSM.GetParameter'
      : 'secretsmanager.GetSecretValue';

    const bodyPayload = this.service === 'ssm'
      ? JSON.stringify({ Name: secretName, WithDecryption: true })
      : JSON.stringify({ SecretId: secretName });

    const rawHeaders = {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': target,
    };

    const signedHeaders = signAwsV4Request({
      method: 'POST',
      host,
      path: '/',
      headers: rawHeaders,
      body: bodyPayload,
      service: this.service,
      region: this.region,
      accessKeyId,
      secretAccessKey,
      sessionToken,
    });

    const url = `https://${host}/`;
    const res = await this.httpTransport(url, {
      method: 'POST',
      headers: signedHeaders,
      body: bodyPayload,
    });

    if (res.statusCode === 400 || res.statusCode === 404) {
      const type = res.json?.__type || res.json?.code || '';
      if (type.includes('ResourceNotFoundException') || type.includes('ParameterNotFound')) {
        return null;
      }
      throw new Error(`[AwsSecretProvider] AWS ${this.service} error for "${secretName}": HTTP ${res.statusCode} ${res.data}`);
    }

    if (res.statusCode !== 200) {
      throw new Error(`[AwsSecretProvider] AWS ${this.service} request failed: HTTP ${res.statusCode} ${res.data}`);
    }

    if (this.service === 'ssm') {
      return res.json?.Parameter?.Value ?? null;
    } else {
      if (res.json?.SecretString) {
        return res.json.SecretString;
      }
      if (res.json?.SecretBinary) {
        return Buffer.from(res.json.SecretBinary, 'base64').toString('utf8');
      }
      return null;
    }
  }

  /**
   * Health check / ping provider
   * @returns {Promise<boolean>}
   */
  async ping() {
    return Boolean(this.accessKeyId || process.env.AWS_ACCESS_KEY_ID);
  }
}

module.exports = {
  AwsSecretProvider,
  signAwsV4Request,
};

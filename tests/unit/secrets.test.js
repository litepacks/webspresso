import { createTempDir, cleanupDir } from '../utils';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const {
  createSecretManager,
  loadSecrets,
  resolveSecret,
  SecretManager,
  SecretNotFoundError,
  EnvSecretProvider,
  MemorySecretProvider,
  GcpSecretProvider,
  AwsSecretProvider,
} = require('../../core/secrets');
const { signAwsV4Request } = require('../../core/secrets/providers/aws');
const { runSecretsPull, formatEnvFile, discoverExpectedSecretKeys } = require('../../bin/commands/secrets-pull');
const { createCoreApp } = require('../../core');

describe('Cloud Secrets Management (core/secrets & secrets:pull)', () => {
  let tmpDir;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = createTempDir('webspresso-secrets-test');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    cleanupDir(tmpDir);
    vi.restoreAllMocks();
  });

  // ====================================================
  // 1. Env & Memory Providers
  // ====================================================
  describe('Env & Memory Secret Providers', () => {
    it('EnvSecretProvider reads from process.env with optional prefix', async () => {
      process.env.APP_SECRET = 'super-secret-value';
      process.env.PREFIX_TOKEN = 'token-value';

      const provider = new EnvSecretProvider();
      expect(await provider.get('APP_SECRET')).toBe('super-secret-value');
      expect(await provider.get('NON_EXISTENT')).toBeNull();

      const prefixedProvider = new EnvSecretProvider({ prefix: 'PREFIX_' });
      expect(await prefixedProvider.get('TOKEN')).toBe('token-value');
    });

    it('MemorySecretProvider supports setting, getting, and clearing in-memory secrets', async () => {
      const provider = new MemorySecretProvider({
        secrets: {
          API_KEY: 'test-api-key',
          CONFIG: { port: 8080 },
        },
      });

      expect(await provider.get('API_KEY')).toBe('test-api-key');
      expect(await provider.get('CONFIG')).toBe('{"port":8080}');

      provider.set('NEW_SECRET', '12345');
      expect(await provider.get('NEW_SECRET')).toBe('12345');

      provider.delete('API_KEY');
      expect(await provider.get('API_KEY')).toBeNull();

      provider.clear();
      expect(await provider.get('NEW_SECRET')).toBeNull();
    });
  });

  // ====================================================
  // 2. Google Cloud Secret Manager Provider
  // ====================================================
  describe('Google Cloud Secret Manager Provider', () => {
    it('fetches and base64-decodes secret via zero-dependency REST API', async () => {
      const mockPayloadData = Buffer.from('gcp-secret-content-42').toString('base64');
      const mockTransport = vi.fn().mockResolvedValue({
        statusCode: 200,
        json: {
          name: 'projects/my-test-proj/secrets/MY_SECRET/versions/latest',
          payload: { data: mockPayloadData },
        },
        data: '{"payload":{"data":"..."}}',
      });

      const provider = new GcpSecretProvider({
        projectId: 'my-test-proj',
        token: 'mock-oauth2-token',
        httpTransport: mockTransport,
      });

      const value = await provider.get('MY_SECRET');
      expect(value).toBe('gcp-secret-content-42');
      expect(mockTransport).toHaveBeenCalledTimes(1);

      const [calledUrl, calledOpts] = mockTransport.mock.calls[0];
      expect(calledUrl).toContain('projects/my-test-proj/secrets/MY_SECRET/versions/latest:access');
      expect(calledOpts.headers.Authorization).toBe('Bearer mock-oauth2-token');
    });

    it('handles explicit version in secret name (e.g. SECRET_NAME:3)', async () => {
      const mockPayloadData = Buffer.from('v3-secret').toString('base64');
      const mockTransport = vi.fn().mockResolvedValue({
        statusCode: 200,
        json: { payload: { data: mockPayloadData } },
        data: '{}',
      });

      const provider = new GcpSecretProvider({
        projectId: 'my-proj',
        token: 'token',
        httpTransport: mockTransport,
      });

      const val = await provider.get('DATABASE_URL:3');
      expect(val).toBe('v3-secret');
      expect(mockTransport.mock.calls[0][0]).toContain('versions/3:access');
    });

    it('returns null on 404 Not Found', async () => {
      const mockTransport = vi.fn().mockResolvedValue({
        statusCode: 404,
        json: null,
        data: 'Not Found',
      });

      const provider = new GcpSecretProvider({
        projectId: 'proj',
        token: 'token',
        httpTransport: mockTransport,
      });

      expect(await provider.get('MISSING_SECRET')).toBeNull();
    });

    it('fetches access token from GCP Metadata server when running in Cloud Run', async () => {
      let callCount = 0;
      const mockTransport = vi.fn().mockImplementation((url) => {
        callCount++;
        if (url.includes('metadata.google.internal')) {
          return Promise.resolve({
            statusCode: 200,
            json: { access_token: 'metadata-acquired-token', expires_in: 3600 },
            data: '{"access_token":"metadata-acquired-token"}',
          });
        }
        return Promise.resolve({
          statusCode: 200,
          json: { payload: { data: Buffer.from('cloud-run-secret').toString('base64') } },
          data: '{}',
        });
      });

      const provider = new GcpSecretProvider({
        projectId: 'cloudrun-proj',
        httpTransport: mockTransport,
      });

      const secret = await provider.get('APP_KEY');
      expect(secret).toBe('cloud-run-secret');
      expect(mockTransport).toHaveBeenCalledTimes(2); // 1 token request + 1 secret request
    });

    it('supports duck-typed official client', async () => {
      const mockClient = {
        accessSecretVersion: vi.fn().mockResolvedValue([{
          payload: { data: Buffer.from('client-secret').toString('base64') },
        }]),
      };

      const provider = new GcpSecretProvider({
        projectId: 'proj',
        client: mockClient,
      });

      const secret = await provider.get('OFFICIAL_CLIENT_SECRET');
      expect(secret).toBe('client-secret');
      expect(mockClient.accessSecretVersion).toHaveBeenCalledWith({
        name: 'projects/proj/secrets/OFFICIAL_CLIENT_SECRET/versions/latest',
      });
    });
  });

  // ====================================================
  // 3. AWS Secrets Manager & SSM Provider
  // ====================================================
  describe('AWS Secrets Manager & SSM Parameter Store Provider', () => {
    it('generates standard AWS SigV4 authorization headers', () => {
      const signed = signAwsV4Request({
        method: 'POST',
        host: 'secretsmanager.us-east-1.amazonaws.com',
        path: '/',
        headers: { 'content-type': 'application/x-amz-json-1.1' },
        body: JSON.stringify({ SecretId: 'test-secret' }),
        service: 'secretsmanager',
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        date: new Date('2026-10-20T12:00:00.000Z'),
      });

      expect(signed['x-amz-date']).toBe('20261020T120000Z');
      expect(signed.Authorization).toContain('AWS4-HMAC-SHA256');
      expect(signed.Authorization).toContain('Credential=AKIAIOSFODNN7EXAMPLE/20261020/us-east-1/secretsmanager/aws4_request');
      expect(signed.Authorization).toContain('SignedHeaders=content-type;host;x-amz-date');
      expect(signed.Authorization).toContain('Signature=');
    });

    it('fetches secret from AWS Secrets Manager via REST API', async () => {
      const mockTransport = vi.fn().mockResolvedValue({
        statusCode: 200,
        json: {
          ARN: 'arn:aws:secretsmanager:us-east-1:12345:secret:db-url',
          Name: 'db-url',
          SecretString: 'postgres://user:pass@aurora.rds:5432/main',
        },
        data: '{}',
      });

      const provider = new AwsSecretProvider({
        region: 'us-east-1',
        accessKeyId: 'TESTKEY',
        secretAccessKey: 'TESTSECRET',
        httpTransport: mockTransport,
      });

      const secret = await provider.get('db-url');
      expect(secret).toBe('postgres://user:pass@aurora.rds:5432/main');

      const [calledUrl, calledOpts] = mockTransport.mock.calls[0];
      expect(calledUrl).toBe('https://secretsmanager.us-east-1.amazonaws.com/');
      expect(calledOpts.headers['x-amz-target']).toBe('secretsmanager.GetSecretValue');
      expect(calledOpts.headers.Authorization).toContain('secretsmanager/aws4_request');
    });

    it('fetches decrypted parameter from AWS SSM Parameter Store', async () => {
      const mockTransport = vi.fn().mockResolvedValue({
        statusCode: 200,
        json: {
          Parameter: {
            Name: '/prod/app/stripe_key',
            Value: 'sk_live_123456789',
          },
        },
        data: '{}',
      });

      const provider = new AwsSecretProvider({
        service: 'ssm',
        region: 'eu-west-1',
        accessKeyId: 'TESTKEY',
        secretAccessKey: 'TESTSECRET',
        httpTransport: mockTransport,
      });

      const secret = await provider.get('/prod/app/stripe_key');
      expect(secret).toBe('sk_live_123456789');

      const [calledUrl, calledOpts] = mockTransport.mock.calls[0];
      expect(calledUrl).toBe('https://ssm.eu-west-1.amazonaws.com/');
      expect(calledOpts.headers['x-amz-target']).toBe('AmazonSSM.GetParameter');
      expect(calledOpts.headers.Authorization).toContain('ssm/aws4_request');
    });

    it('returns null on ResourceNotFoundException', async () => {
      const mockTransport = vi.fn().mockResolvedValue({
        statusCode: 400,
        json: { __type: 'ResourceNotFoundException', message: 'Secrets Manager can’t find the specified secret.' },
        data: '{"__type":"ResourceNotFoundException"}',
      });

      const provider = new AwsSecretProvider({
        accessKeyId: 'KEY',
        secretAccessKey: 'SECRET',
        httpTransport: mockTransport,
      });

      expect(await provider.get('NON_EXISTENT')).toBeNull();
    });

    it('supports duck-typed AWS SDK client', async () => {
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          SecretString: 'aws-sdk-client-secret',
        }),
      };

      const provider = new AwsSecretProvider({
        client: mockClient,
      });

      const secret = await provider.get('MY_AWS_SECRET');
      expect(secret).toBe('aws-sdk-client-secret');
      expect(mockClient.send).toHaveBeenCalledWith({ SecretId: 'MY_AWS_SECRET' });
    });
  });

  // ====================================================
  // 4. SecretManager Orchestration & Features
  // ====================================================
  describe('SecretManager Orchestrator', () => {
    it('caches secret values in-memory with TTL and allows invalidation', async () => {
      let callCount = 0;
      const mockProvider = {
        get: vi.fn().mockImplementation(async (name) => {
          callCount++;
          return `value-${name}-${callCount}`;
        }),
      };

      const manager = new SecretManager({
        provider: mockProvider,
        cacheTtl: '10m',
      });

      // 1st call -> provider fetched
      const val1 = await manager.get('TOKEN');
      expect(val1).toBe('value-TOKEN-1');
      expect(callCount).toBe(1);

      // 2nd call -> cached, provider not called
      const val2 = await manager.get('TOKEN');
      expect(val2).toBe('value-TOKEN-1');
      expect(callCount).toBe(1);

      // Invalidate cache
      manager.invalidate('TOKEN');
      const val3 = await manager.get('TOKEN');
      expect(val3).toBe('value-TOKEN-2');
      expect(callCount).toBe(2);

      // Bypass cache option
      const val4 = await manager.get('TOKEN', { bypassCache: true });
      expect(val4).toBe('value-TOKEN-3');
      expect(callCount).toBe(3);

      // Clear all cache
      manager.clearCache();
      const val5 = await manager.get('TOKEN');
      expect(val5).toBe('value-TOKEN-4');
      expect(callCount).toBe(4);
    });

    it('resolves JSON subkeys using dot-notation (e.g. bundle.DATABASE_URL)', async () => {
      const mockProvider = {
        get: vi.fn().mockResolvedValue(JSON.stringify({
          DATABASE_URL: 'postgres://db.prod:5432/main',
          JWT_SECRET: 'jwt-ultra-secret',
          NESTED: { key: 99 },
        })),
      };

      const manager = new SecretManager({ provider: mockProvider });

      expect(await manager.get('prod/app.DATABASE_URL')).toBe('postgres://db.prod:5432/main');
      expect(await manager.get('prod/app.JWT_SECRET')).toBe('jwt-ultra-secret');
      expect(await manager.get('prod/app.NON_EXISTENT')).toBeNull();
      expect(await manager.get('prod/app.NON_EXISTENT', { fallback: 'fb' })).toBe('fb');

      // Whole bundle with parseJson
      const bundle = await manager.get('prod/app', { parseJson: true });
      expect(bundle.NESTED.key).toBe(99);
    });

    it('throws SecretNotFoundError when required: true and secret is missing', async () => {
      const manager = new SecretManager({
        provider: { get: vi.fn().mockResolvedValue(null) },
      });

      await expect(manager.get('MISSING_KEY', { required: true })).rejects.toThrow(SecretNotFoundError);
      expect(await manager.get('MISSING_KEY', { fallback: 'default-val' })).toBe('default-val');
    });

    it('load() resolves multiple secrets and injects them into process.env', async () => {
      const manager = new SecretManager({
        provider: new MemorySecretProvider({
          secrets: {
            'prod-jwt': 'jwt-32-character-secret-value-abcdef',
            'prod-db': 'mysql://localhost/test',
          },
        }),
      });

      const loaded = await manager.load({
        JWT_SECRET: 'prod-jwt',
        DATABASE_URL: 'prod-db',
      }, { inject: true });

      expect(loaded.JWT_SECRET).toBe('jwt-32-character-secret-value-abcdef');
      expect(process.env.JWT_SECRET).toBe('jwt-32-character-secret-value-abcdef');
      expect(process.env.DATABASE_URL).toBe('mysql://localhost/test');
    });

    it('loadBundle() unpacks a JSON secret bundle into process.env', async () => {
      const manager = new SecretManager({
        provider: new MemorySecretProvider({
          secrets: {
            'prod/app/config': {
              REDIS_URL: 'redis://cache.internal:6379',
              SESSION_SECRET: 'session-secret-abcdef-1234567890',
            },
          },
        }),
      });

      const unpacked = await manager.loadBundle('prod/app/config', { inject: true });
      expect(unpacked.REDIS_URL).toBe('redis://cache.internal:6379');
      expect(process.env.REDIS_URL).toBe('redis://cache.internal:6379');
      expect(process.env.SESSION_SECRET).toBe('session-secret-abcdef-1234567890');
    });
  });

  // ====================================================
  // 5. Convenience Functions & App Context
  // ====================================================
  describe('Convenience Functions & Framework Integration', () => {
    it('loadSecrets() bootstrap helper hydrates environment with provider options', async () => {
      const result = await loadSecrets({
        provider: 'memory',
        secrets: {
          PORT: '8080',
          CUSTOM_SECRET: 'hello-world',
        },
        inject: true,
      });

      expect(result.PORT).toBe('8080');
      expect(process.env.CUSTOM_SECRET).toBe('hello-world');
    });

    it('resolveSecret() resolves single secret on demand', async () => {
      process.env.STANDALONE_VAR = 'standalone-val';
      const val = await resolveSecret('STANDALONE_VAR', { provider: 'env' });
      expect(val).toBe('standalone-val');
    });

    it('CoreApp attaches secrets and secret() context helper when options.secrets is provided', async () => {
      const app = createCoreApp({
        secrets: {
          provider: 'memory',
          mockSecrets: {
            API_KEY: 'core-app-key-99',
          },
        },
      });

      expect(app.secrets).toBeInstanceOf(SecretManager);
      const ctx = app.createContext();
      expect(typeof ctx.secret).toBe('function');
      expect(await ctx.secret('API_KEY')).toBe('core-app-key-99');
    });
  });

  // ====================================================
  // 6. CLI secrets:pull Command
  // ====================================================
  describe('CLI Command (secrets:pull)', () => {
    it('formats key-value entries as clean .env file', () => {
      const content = formatEnvFile({
        SIMPLE: 'value',
        WITH_SPACES: 'hello world',
        MULTILINE: 'line1\nline2',
      });

      expect(content).toContain('SIMPLE=value');
      expect(content).toContain('WITH_SPACES="hello world"');
      expect(content).toContain('MULTILINE="line1\\nline2"');
    });

    it('discoverExpectedSecretKeys detects keys from existing .env.example', () => {
      fs.writeFileSync(path.join(tmpDir, '.env.example'), 'SESSION_SECRET=\nDATABASE_URL=\nPORT=3000\n');
      const keys = discoverExpectedSecretKeys(tmpDir);
      expect(keys).toEqual(['SESSION_SECRET', 'DATABASE_URL', 'PORT']);
    });

    it('runSecretsPull pulls secrets to .env.local file', async () => {
      const mockTransport = vi.fn().mockResolvedValue({
        statusCode: 200,
        json: {
          payload: { data: Buffer.from('pulled-secret-token').toString('base64') },
        },
        data: '{}',
      });

      const res = await runSecretsPull({
        cwd: tmpDir,
        platform: 'cloudrun',
        project: 'my-gcp-proj',
        secrets: ['SESSION_SECRET'],
        output: '.env.local',
        httpTransport: mockTransport,
      });

      expect(res.success).toBe(true);
      expect(res.count).toBe(1);
      expect(res.values.SESSION_SECRET).toBe('pulled-secret-token');

      const writtenFile = fs.readFileSync(path.join(tmpDir, '.env.local'), 'utf8');
      expect(writtenFile).toContain('SESSION_SECRET=pulled-secret-token');
    });

    it('runSecretsPull supports JSON format and dry-run without writing to disk', async () => {
      const mockTransport = vi.fn().mockResolvedValue({
        statusCode: 200,
        json: {
          SecretString: 'dry-run-secret',
        },
        data: '{}',
      });

      const res = await runSecretsPull({
        cwd: tmpDir,
        platform: 'aws',
        secrets: ['DATABASE_URL'],
        format: 'json',
        dryRun: true,
        output: 'secrets.json',
        httpTransport: mockTransport,
      });

      expect(res.count).toBe(1);
      expect(res.output).toContain('"DATABASE_URL": "dry-run-secret"');
      expect(fs.existsSync(path.join(tmpDir, 'secrets.json'))).toBe(false);
    });
  });
});

/**
 * Unit tests for Webhook Sender Module
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendWebhook, isMetadataAddress } from '../../../plugins/webhooks/sender';

describe('Webhook Sender Module', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns failure object when URL is missing or invalid', async () => {
    const res1 = await sendWebhook({});
    expect(res1.success).toBe(false);
    expect(res1.statusCode).toBe(0);
    expect(res1.error).toContain('destination URL is required');

    const res2 = await sendWebhook({ url: null });
    expect(res2.success).toBe(false);
    expect(res2.statusCode).toBe(0);
  });

  it('refuses cloud metadata targets without sending (SSRF)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ status: 200, text: async () => 'creds' });

    for (const url of [
      'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://[fd00:ec2::254]/latest/meta-data/',
      'http://[fe80::1]/',
      'http://100.100.100.200/latest/meta-data/',
    ]) {
      const res = await sendWebhook({ url, event: 'x', payload: {} });
      expect(res.success, url).toBe(false);
      expect(res.error).toContain('metadata');
    }
    expect(fetchSpy).not.toHaveBeenCalled();

    expect(isMetadataAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isMetadataAddress('10.0.0.5')).toBe(false);
    expect(isMetadataAddress('93.184.216.34')).toBe(false);
  });

  it('does not follow redirects', async () => {
    let capturedOptions = {};
    vi.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
      capturedOptions = opts;
      return { status: 200, statusText: 'OK', text: async () => '' };
    });
    await sendWebhook({ url: 'https://127.0.0.1:9/hook', event: 'x', payload: {} });
    expect(capturedOptions.redirect).toBe('manual');
  });

  it('sends POST request with wrapped payload, headers, and signatures', async () => {
    let capturedUrl = '';
    let capturedOptions = {};

    vi.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
      capturedUrl = url;
      capturedOptions = opts;
      return {
        status: 200,
        statusText: 'OK',
        text: async () => '{"received":true}',
      };
    });

    const result = await sendWebhook({
      url: 'https://webhook.site/test',
      event: 'user.created',
      payload: { userId: 42, email: 'test@example.com' },
      secret: 'super-secret-key-123',
      headers: JSON.stringify({ 'X-Custom-Tenant': 'tenant_abc' }),
      timeoutMs: 5000,
      wrapPayload: true,
    });

    expect(capturedUrl).toBe('https://webhook.site/test');
    expect(capturedOptions.method).toBe('POST');
    expect(capturedOptions.headers['content-type']).toBe('application/json');
    expect(capturedOptions.headers['x-webspresso-event']).toBe('user.created');
    expect(capturedOptions.headers['x-webspresso-signature']).toBeDefined();
    expect(capturedOptions.headers['webhook-signature']).toBeDefined();
    expect(capturedOptions.headers['X-Custom-Tenant']).toBe('tenant_abc');

    const parsedBody = JSON.parse(capturedOptions.body);
    expect(parsedBody.event).toBe('user.created');
    expect(parsedBody.data).toEqual({ userId: 42, email: 'test@example.com' });

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.responseBody).toBe('{"received":true}');
    expect(result.error).toBeNull();
  });

  it('supports raw payload without wrapping when wrapPayload is false', async () => {
    let capturedOptions = {};
    vi.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
      capturedOptions = opts;
      return {
        status: 204,
        statusText: 'No Content',
        text: async () => '',
      };
    });

    const rawData = { id: 1, event: 'already.wrapped' };
    const result = await sendWebhook({
      url: 'https://webhook.site/raw',
      event: 'raw.event',
      payload: rawData,
      wrapPayload: false,
    });

    expect(JSON.parse(capturedOptions.body)).toEqual(rawData);
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(204);
  });

  it('handles non-200 responses as failure', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => 'Upstream service unavailable',
    });

    const result = await sendWebhook({
      url: 'https://webhook.site/error',
      event: 'ping',
      payload: {},
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(502);
    expect(result.error).toContain('HTTP 502: Bad Gateway');
    expect(result.responseBody).toBe('Upstream service unavailable');
  });

  it('handles network / connection errors gracefully', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await sendWebhook({
      url: 'https://invalid-host-destination.local',
      event: 'test',
      payload: {},
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(0);
    expect(result.error).toBe('ECONNREFUSED');
  });

  it('handles request timeout abort error properly', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    vi.spyOn(global, 'fetch').mockRejectedValue(abortErr);

    const result = await sendWebhook({
      url: 'https://slow-server.test',
      event: 'slow',
      payload: {},
      timeoutMs: 250,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(0);
    expect(result.error).toContain('timed out after 250ms');
  });
});

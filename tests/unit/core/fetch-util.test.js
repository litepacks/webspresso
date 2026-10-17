import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithTimeout } from '../../../core/utils/fetch';
import { utils } from '../../../src/helpers';
import webspresso from '../../../index';

describe('Zero-Dependency Fetch Utility (core/utils/fetch)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('exports fetchWithTimeout across core, helpers.utils, and root module', () => {
    expect(typeof fetchWithTimeout).toBe('function');
    expect(typeof utils.fetchWithTimeout).toBe('function');
    expect(typeof webspresso.fetchWithTimeout).toBe('function');
  });

  it('successfully executes fetch and forwards options', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ message: 'ok' }),
      headers: new Headers({ 'content-type': 'application/json' }),
    };

    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    const res = await fetchWithTimeout('https://api.example.com/test', {
      method: 'POST',
      headers: { 'X-Custom-Header': 'val' },
      body: JSON.stringify({ key: 'val' }),
      timeout: 5000,
    });

    expect(res).toBe(mockResponse);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [calledUrl, calledOpts] = global.fetch.mock.calls[0];
    expect(calledUrl).toBe('https://api.example.com/test');
    expect(calledOpts.method).toBe('POST');
    expect(calledOpts.headers['X-Custom-Header']).toBe('val');
    expect(calledOpts.signal).toBeInstanceOf(AbortSignal);
  });

  it('times out and throws TimeoutError (ETIMEDOUT) when request exceeds timeout', async () => {
    // Simulate a fetch that hangs until aborted
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      return new Promise((resolve, reject) => {
        if (opts.signal) {
          opts.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    });

    await expect(
      fetchWithTimeout('https://api.example.com/hang', { timeout: 30 })
    ).rejects.toMatchObject({
      name: 'TimeoutError',
      code: 'ETIMEDOUT',
    });
  });

  it('supports caller-provided AbortSignal and aborts immediately if already aborted', async () => {
    global.fetch = vi.fn();

    const controller = new AbortController();
    controller.abort(new Error('Pre-aborted by caller'));

    await expect(
      fetchWithTimeout('https://api.example.com/aborted', { signal: controller.signal })
    ).rejects.toThrow('Pre-aborted by caller');

    // Should not even have called fetch
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('supports caller-provided AbortSignal aborting while in flight', async () => {
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      return new Promise((resolve, reject) => {
        if (opts.signal) {
          opts.signal.addEventListener('abort', () => {
            reject(opts.signal.reason);
          });
        }
      });
    });

    const controller = new AbortController();
    const fetchPromise = fetchWithTimeout('https://api.example.com/inflight', {
      signal: controller.signal,
      timeout: 10000,
    });

    // Abort after 20ms
    setTimeout(() => {
      controller.abort(new Error('Manual user abort'));
    }, 20);

    await expect(fetchPromise).rejects.toThrow('Manual user abort');
  });

  it('supports disabling timeout with timeout: 0 or timeout: false', async () => {
    const mockResponse = { ok: true, status: 200 };
    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    const res = await fetchWithTimeout('https://api.example.com/no-timeout', { timeout: 0 });
    expect(res).toBe(mockResponse);
  });

  it('fetchWithTimeout.json parses json and fallback text responses', async () => {
    const mockJsonResponse = {
      ok: true,
      headers: {
        get: (h) => (h === 'content-type' ? 'application/json; charset=utf-8' : null),
      },
      json: vi.fn().mockResolvedValue({ id: 123, title: 'Item' }),
    };

    global.fetch = vi.fn().mockResolvedValueOnce(mockJsonResponse);

    const { res, data } = await fetchWithTimeout.json('https://api.example.com/json', { timeout: 1000 });
    expect(res).toBe(mockJsonResponse);
    expect(data).toEqual({ id: 123, title: 'Item' });

    // Fallback text response
    const mockTextResponse = {
      ok: true,
      headers: {
        get: () => 'text/plain',
      },
      text: vi.fn().mockResolvedValue('{"rawJson": true}'),
    };

    global.fetch = vi.fn().mockResolvedValueOnce(mockTextResponse);
    const result2 = await fetchWithTimeout.json('https://api.example.com/text-json', { timeout: 1000 });
    expect(result2.data).toEqual({ rawJson: true });
  });
});

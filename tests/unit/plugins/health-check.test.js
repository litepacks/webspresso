/**
 * Unit tests for Health Check Plugin
 * @vitest-environment node
 */

import { describe, it, expect, vi } from 'vitest';
import healthCheckPlugin from '../../../plugins/health-check';

describe('Health Check Plugin', () => {
  it('creates plugin definition with default options', () => {
    const plugin = healthCheckPlugin();
    expect(plugin.name).toBe('health-check');
    expect(plugin.version).toBe('1.0.0');
    expect(typeof plugin.onRoutesReady).toBe('function');
  });

  it('skips route registration when enabled is false', () => {
    const plugin = healthCheckPlugin({ enabled: false });
    const addRoute = vi.fn();
    const ctx = { addRoute };

    plugin.onRoutesReady(ctx);
    expect(addRoute).not.toHaveBeenCalled();
  });

  it('registers route on custom path with leading slash normalization', () => {
    const plugin = healthCheckPlugin({ path: 'ping' });
    let registeredPath = null;
    let registeredHandler = null;

    const ctx = {
      addRoute: (method, path, handler) => {
        expect(method).toBe('get');
        registeredPath = path;
        registeredHandler = handler;
      },
    };

    plugin.onRoutesReady(ctx);
    expect(registeredPath).toBe('/ping');
    expect(typeof registeredHandler).toBe('function');
  });

  it('serves default verbose health check payload', async () => {
    const plugin = healthCheckPlugin();
    let handler;
    plugin.onRoutesReady({
      addRoute: (method, path, fn) => {
        handler = fn;
      },
    });

    let jsonResult = null;
    const req = {};
    const res = {
      json: (data) => {
        jsonResult = data;
      },
      status: vi.fn().mockReturnThis(),
    };

    await handler(req, res);
    expect(jsonResult.status).toBe('ok');
    expect(jsonResult.timestamp).toBeDefined();
    expect(typeof jsonResult.uptime).toBe('number');
    expect(jsonResult.env).toBeDefined();
    expect(jsonResult.framework.name).toBe('webspresso');
  });

  it('serves minimal payload when verbose is false', async () => {
    const plugin = healthCheckPlugin({ verbose: false });
    let handler;
    plugin.onRoutesReady({
      addRoute: (method, path, fn) => {
        handler = fn;
      },
    });

    let jsonResult = null;
    const req = {};
    const res = {
      json: (data) => {
        jsonResult = data;
      },
      status: vi.fn().mockReturnThis(),
    };

    await handler(req, res);
    expect(jsonResult).toEqual({ status: 'ok' });
    expect(jsonResult.timestamp).toBeUndefined();
    expect(jsonResult.framework).toBeUndefined();
  });

  it('blocks unauthorized requests when authorize hook returns false', async () => {
    const authorize = vi.fn().mockReturnValue(false);
    const plugin = healthCheckPlugin({ authorize });
    let handler;
    plugin.onRoutesReady({
      addRoute: (method, path, fn) => {
        handler = fn;
      },
    });

    const statusMock = vi.fn().mockReturnThis();
    const jsonMock = vi.fn();
    const req = { headers: {} };
    const res = { status: statusMock, json: jsonMock };

    await handler(req, res);
    expect(authorize).toHaveBeenCalledWith(req);
    expect(statusMock).toHaveBeenCalledWith(403);
    expect(jsonMock).toHaveBeenCalledWith({ error: 'Forbidden' });
  });

  it('allows authorized requests when authorize hook returns true', async () => {
    const authorize = vi.fn().mockReturnValue(true);
    const plugin = healthCheckPlugin({ authorize });
    let handler;
    plugin.onRoutesReady({
      addRoute: (method, path, fn) => {
        handler = fn;
      },
    });

    let jsonResult = null;
    const req = { headers: { 'x-probe': '1' } };
    const res = {
      json: (data) => {
        jsonResult = data;
      },
      status: vi.fn().mockReturnThis(),
    };

    await handler(req, res);
    expect(authorize).toHaveBeenCalledWith(req);
    expect(jsonResult.status).toBe('ok');
  });

  it('executes custom checks and includes results in payload', async () => {
    const checks = vi.fn().mockResolvedValue({
      database: 'connected',
      cache: 'ready',
    });
    const plugin = healthCheckPlugin({ checks });
    let handler;
    const mockCtx = {
      db: { ping: true },
      options: { test: 123 },
      addRoute: (method, path, fn) => {
        handler = fn;
      },
    };
    plugin.onRoutesReady(mockCtx);

    let jsonResult = null;
    const req = {};
    const res = {
      json: (data) => {
        jsonResult = data;
      },
      status: vi.fn().mockReturnThis(),
    };

    await handler(req, res);
    expect(checks).toHaveBeenCalledWith({
      req,
      db: mockCtx.db,
      options: mockCtx.options,
    });
    expect(jsonResult.checks).toEqual({
      database: 'connected',
      cache: 'ready',
    });
    expect(jsonResult.status).toBe('ok');
  });

  it('returns 503 and unhealthy status when custom checks throw', async () => {
    const checks = vi.fn().mockRejectedValue(new Error('Database ping timeout'));
    const plugin = healthCheckPlugin({ checks });
    let handler;
    plugin.onRoutesReady({
      addRoute: (method, path, fn) => {
        handler = fn;
      },
    });

    const statusMock = vi.fn().mockReturnThis();
    const jsonMock = vi.fn();
    const req = {};
    const res = { status: statusMock, json: jsonMock };

    await handler(req, res);
    expect(statusMock).toHaveBeenCalledWith(503);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'unhealthy',
        error: 'Database ping timeout',
      })
    );
  });

  it('handles non-Error thrown values gracefully in checks', async () => {
    const checks = vi.fn().mockRejectedValue('Fatal network error');
    const plugin = healthCheckPlugin({ checks });
    let handler;
    plugin.onRoutesReady({
      addRoute: (method, path, fn) => {
        handler = fn;
      },
    });

    const statusMock = vi.fn().mockReturnThis();
    const jsonMock = vi.fn();
    const req = {};
    const res = { status: statusMock, json: jsonMock };

    await handler(req, res);
    expect(statusMock).toHaveBeenCalledWith(503);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'unhealthy',
        error: 'Fatal network error',
      })
    );
  });
});

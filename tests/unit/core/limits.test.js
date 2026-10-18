'use strict';

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import {
  createApp,
  limits,
  normalizeLimits,
  setupLimitsMiddleware,
  createLimitsMiddleware,
  parseByteSize,
  PayloadTooLargeError,
  BadRequestError,
} from '../../../index';

describe('Payload Limits & DoS Protection (core/limits)', () => {
  describe('parseByteSize', () => {
    it('returns numbers unchanged', () => {
      expect(parseByteSize(1024)).toBe(1024);
      expect(parseByteSize(0)).toBe(0);
      expect(parseByteSize(500.5)).toBe(500);
    });

    it('parses byte unit strings accurately', () => {
      expect(parseByteSize('500b')).toBe(500);
      expect(parseByteSize('1kb')).toBe(1024);
      expect(parseByteSize('2k')).toBe(2048);
      expect(parseByteSize('1mb')).toBe(1024 * 1024);
      expect(parseByteSize('5MB')).toBe(5 * 1024 * 1024);
      expect(parseByteSize('1.5 mb')).toBe(Math.floor(1.5 * 1024 * 1024));
      expect(parseByteSize('1gb')).toBe(1024 * 1024 * 1024);
    });

    it('returns raw strings if unable to parse so Express bytes handler can evaluate', () => {
      expect(parseByteSize('custom-unit')).toBe('custom-unit');
      expect(parseByteSize('')).toBe('');
    });
  });

  describe('normalizeLimits', () => {
    it('provides secure and sensible defaults when empty', () => {
      const cfg = normalizeLimits();
      expect(cfg.json.enabled).toBe(true);
      expect(cfg.json.limit).toBe(1024 * 1024); // 1mb
      expect(cfg.json.strict).toBe(true);

      expect(cfg.urlencoded.enabled).toBe(true);
      expect(cfg.urlencoded.limit).toBe(1024 * 1024);
      expect(cfg.urlencoded.extended).toBe(true);
      expect(cfg.urlencoded.parameterLimit).toBe(1000);

      expect(cfg.raw.enabled).toBe(false);
      expect(cfg.text.enabled).toBe(false);
      expect(cfg.captureRawBody).toBe(false);
      expect(cfg.exclude).toEqual([]);
      expect(cfg.routes).toEqual({});
    });

    it('accepts string shorthand to set global body limit', () => {
      const cfg = normalizeLimits('5mb');
      expect(cfg.json.enabled).toBe(true);
      expect(cfg.json.limit).toBe(5 * 1024 * 1024);
      expect(cfg.urlencoded.limit).toBe(5 * 1024 * 1024);
    });

    it('accepts number shorthand in bytes', () => {
      const cfg = normalizeLimits(2097152);
      expect(cfg.json.limit).toBe(2097152);
      expect(cfg.urlencoded.limit).toBe(2097152);
    });

    it('unwraps options.limits or options.server.limits', () => {
      const fromTop = normalizeLimits({ limits: { json: '2mb' } });
      expect(fromTop.json.limit).toBe(2 * 1024 * 1024);

      const fromServer = normalizeLimits({ server: { limits: { json: '3mb' } } });
      expect(fromServer.json.limit).toBe(3 * 1024 * 1024);
    });

    it('allows disabling specific parsers with boolean false', () => {
      const cfg = normalizeLimits({
        json: false,
        urlencoded: false,
      });
      expect(cfg.json.enabled).toBe(false);
      expect(cfg.urlencoded.enabled).toBe(false);
    });

    it('enables raw and text parsers when requested', () => {
      const cfg = normalizeLimits({
        raw: '10mb',
        text: true,
      });
      expect(cfg.raw.enabled).toBe(true);
      expect(cfg.raw.limit).toBe(10 * 1024 * 1024);
      expect(cfg.text.enabled).toBe(true);
      expect(cfg.text.limit).toBe(1024 * 1024);
    });

    it('syncs parameterLimit to urlencoded parser', () => {
      const cfg = normalizeLimits({
        parameterLimit: 5000,
      });
      expect(cfg.parameterLimit).toBe(5000);
      expect(cfg.urlencoded.parameterLimit).toBe(5000);
    });

    it('normalizes per-route overrides', () => {
      const cfg = normalizeLimits({
        routes: {
          '/api/upload': { json: '25mb' },
          '/api/stream': false,
        },
      });
      expect(cfg.routes['/api/upload'].json.limit).toBe(25 * 1024 * 1024);
      expect(cfg.routes['/api/stream']).toBe(false);
    });
  });

  describe('Path and Exclusion Matchers', () => {
    const { matchesPath, shouldSkipBodyParser, shouldCaptureRawBody } = limits;

    it('matches exact strings', () => {
      expect(matchesPath('/api/users', '/api/users')).toBe(true);
      expect(matchesPath('/api/users', '/api/other')).toBe(false);
    });

    it('matches wildcard prefix patterns', () => {
      expect(matchesPath('/api/webhooks/*', '/api/webhooks/polar')).toBe(true);
      expect(matchesPath('/api/webhooks/*', '/api/webhooks/stripe')).toBe(true);
      expect(matchesPath('/api/webhooks/**', '/api/webhooks/nested/deep')).toBe(true);
      expect(matchesPath('/api/webhooks/*', '/api/other')).toBe(false);
    });

    it('matches Express parameter paths', () => {
      expect(matchesPath('/api/users/:id/avatar', '/api/users/123/avatar')).toBe(true);
      expect(matchesPath('/api/users/:id/avatar', '/api/users/abc-def/avatar')).toBe(true);
      expect(matchesPath('/api/users/:id/avatar', '/api/users/123/other')).toBe(false);
    });

    it('matches RegExp patterns', () => {
      expect(matchesPath(/^\/api\/raw\//, '/api/raw/123')).toBe(true);
      expect(matchesPath(/^\/api\/raw\//, '/api/json/123')).toBe(false);
    });

    it('shouldSkipBodyParser checks exclude list against path and originalUrl', () => {
      const excludes = ['/api/stream', '/api/webhooks/*'];
      expect(shouldSkipBodyParser({ path: '/api/stream' }, excludes)).toBe(true);
      expect(shouldSkipBodyParser({ path: '/api/webhooks/stripe' }, excludes)).toBe(true);
      expect(shouldSkipBodyParser({ path: '/api/users' }, excludes)).toBe(false);
      expect(shouldSkipBodyParser({ path: '/other', originalUrl: '/api/stream?foo=1' }, excludes)).toBe(true);
    });

    it('shouldCaptureRawBody evaluates boolean, array, and function', () => {
      expect(shouldCaptureRawBody({}, true)).toBe(true);
      expect(shouldCaptureRawBody({}, false)).toBe(false);

      const patterns = ['/api/webhooks/*'];
      expect(shouldCaptureRawBody({ path: '/api/webhooks/polar' }, patterns)).toBe(true);
      expect(shouldCaptureRawBody({ path: '/api/users' }, patterns)).toBe(false);

      const fn = (req) => req.headers?.['x-webhook'] === '1';
      expect(shouldCaptureRawBody({ headers: { 'x-webhook': '1' } }, fn)).toBe(true);
      expect(shouldCaptureRawBody({ headers: {} }, fn)).toBe(false);
    });
  });

  describe('Integration with Express & createApp', () => {
    it('accepts JSON within default limits and parses req.body', async () => {
      const app = createApp({
        rootDir: process.cwd(),
        pagesDir: 'pages',
        limits: { json: '1mb' },
      });

      app.post('/test-json', (req, res) => {
        res.json({ received: req.body });
      });

      const res = await request(app)
        .post('/test-json')
        .send({ name: 'Webspresso', score: 100 })
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.received).toEqual({ name: 'Webspresso', score: 100 });
    });

    it('rejects JSON payloads exceeding limit with HTTP 413 and PayloadTooLargeError', async () => {
      const app = createApp({
        rootDir: process.cwd(),
        pagesDir: 'pages',
        limits: {
          json: '1kb', // 1024 bytes limit
        },
      });

      app.post('/api/strict-json', (req, res) => {
        res.json({ ok: true });
      });

      // Construct payload ~2.5 KB
      const largePayload = {
        data: 'x'.repeat(2500),
      };

      const res = await request(app)
        .post('/api/strict-json')
        .send(largePayload)
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(413);
      expect(res.body.error).toBe('Payload Too Large');
      expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
      expect(res.body.details).toBeDefined();
      expect(res.body.details.limit).toBe(1024);
    });

    it('rejects malformed JSON with HTTP 400 and BadRequestError', async () => {
      const app = createApp({
        rootDir: process.cwd(),
        pagesDir: 'pages',
      });

      app.post('/api/json-check', (req, res) => {
        res.json({ ok: true });
      });

      const res = await request(app)
        .post('/api/json-check')
        .set('Content-Type', 'application/json')
        .send('{ bad json: 123 ');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Bad Request');
      expect(res.body.code).toBe('INVALID_JSON_PAYLOAD');
    });

    it('enforces urlencoded parameter limits with HTTP 413', async () => {
      const app = createApp({
        rootDir: process.cwd(),
        pagesDir: 'pages',
        limits: {
          parameterLimit: 5, // max 5 form parameters
        },
      });

      app.post('/api/form-check', (req, res) => {
        res.json({ count: Object.keys(req.body).length });
      });

      // Send 10 parameters
      const formBody = 'a=1&b=2&c=3&d=4&e=5&f=6&g=7';

      const res = await request(app)
        .post('/api/form-check')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(formBody);

      expect(res.status).toBe(413);
      expect(res.body.error).toBe('Payload Too Large');
      expect(res.body.code).toBe('PARAMETERS_TOO_MANY');
    });

    it('captures req.rawBody Buffer when captureRawBody is enabled', async () => {
      const app = createApp({
        rootDir: process.cwd(),
        pagesDir: 'pages',
        limits: {
          captureRawBody: true,
        },
      });

      app.post('/api/webhook', (req, res) => {
        expect(Buffer.isBuffer(req.rawBody)).toBe(true);
        res.json({
          hasRawBody: Boolean(req.rawBody),
          rawLength: req.rawBody?.length,
          body: req.body,
        });
      });

      const payload = { event: 'payment.succeeded', amount: 5000 };
      const rawString = JSON.stringify(payload);

      const res = await request(app)
        .post('/api/webhook')
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.hasRawBody).toBe(true);
      expect(res.body.rawLength).toBe(Buffer.byteLength(rawString));
      expect(res.body.body).toEqual(payload);
    });

    it('skips global body parsing on excluded routes', async () => {
      const app = createApp({
        rootDir: process.cwd(),
        pagesDir: 'pages',
        limits: {
          json: '100b',
          exclude: ['/api/stream-upload'],
        },
      });

      app.post('/api/stream-upload', (req, res) => {
        // Stream should remain unparsed by global body parser
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          res.json({ rawLength: raw.length });
        });
      });

      // Send 2 KB to excluded route (exceeding 100b global limit)
      const res = await request(app)
        .post('/api/stream-upload')
        .set('Content-Type', 'application/json')
        .send({ test: 'x'.repeat(2000) });

      expect(res.status).toBe(200);
      expect(res.body.rawLength).toBeGreaterThan(1000);
    });

    it('supports route-level limit overrides via limits.routes', async () => {
      const app = createApp({
        rootDir: process.cwd(),
        pagesDir: 'pages',
        limits: {
          json: '1kb', // global tight limit
          routes: {
            '/api/large-upload': { json: '20kb' }, // generous route limit
          },
        },
      });

      app.post('/api/large-upload', (req, res) => {
        res.json({ size: JSON.stringify(req.body).length });
      });

      app.post('/api/standard-upload', (req, res) => {
        res.json({ size: JSON.stringify(req.body).length });
      });

      // 1. Send 5 KB to /api/large-upload -> succeeds!
      const resLarge = await request(app)
        .post('/api/large-upload')
        .set('Content-Type', 'application/json')
        .send({ payload: 'A'.repeat(5000) });

      expect(resLarge.status).toBe(200);

      // 2. Send 5 KB to /api/standard-upload -> rejected with 413!
      const resStandard = await request(app)
        .post('/api/standard-upload')
        .set('Content-Type', 'application/json')
        .send({ payload: 'A'.repeat(5000) });

      expect(resStandard.status).toBe(413);
      expect(resStandard.body.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('renders clean HTML 413 error for browser form requests', async () => {
      const app = createApp({
        rootDir: process.cwd(),
        pagesDir: 'pages',
        limits: {
          urlencoded: '500b',
        },
      });

      app.post('/contact', (req, res) => {
        res.send('ok');
      });

      const res = await request(app)
        .post('/contact')
        .set('Accept', 'text/html')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('message=' + 'x'.repeat(1000));

      expect(res.status).toBe(413);
      expect(res.text).toContain('413');
      expect(res.text).toContain('Payload Too Large');
    });

    it('invokes custom error handler hook app.setErrorHandler on 413', async () => {
      const app = createApp({
        rootDir: process.cwd(),
        pagesDir: 'pages',
        limits: { json: '500b' },
      });

      let capturedError = null;
      app.setErrorHandler((err, req, res) => {
        capturedError = err;
        res.status(413).json({
          customHandled: true,
          errorType: err.constructor.name,
        });
        return true;
      });

      app.post('/api/hook-test', (req, res) => {
        res.json({ ok: true });
      });

      const res = await request(app)
        .post('/api/hook-test')
        .set('Content-Type', 'application/json')
        .send({ data: 'y'.repeat(1000) });

      expect(res.status).toBe(413);
      expect(res.body.customHandled).toBe(true);
      expect(capturedError).toBeDefined();
    });
  });
});

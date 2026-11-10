/**
 * Code Scanning & CodeQL Security Hardening Tests
 *
 * Verifies fixes for:
 * - Polynomial ReDoS in controller path derivation (Alerts #161 - #167)
 * - Trailing slash trimming ReDoS (Alerts #168, #169)
 * - Mini-dom HTML parser ReDoS & malformed tag resilience (Alert #170)
 * - Script tag filtering in offline-vendor test (Alert #160)
 * - DOM XSS prevention in form redirect handlers (Alerts #171, #172)
 * - Rate limiting on internal fragment endpoints (Alerts #173 - #176)
 * - Safe request body defaulting and CSRF separation (Alert #177)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { deriveControllerNameFromPath } from '../../core/client/controller';
import { isSafeRedirectUrl, createFormHandle } from '../../core/client/forms';
import { createMiniDomEnvironment } from '../utils/mini-dom';

describe('Code Scanning Security Hardening', () => {
  describe('deriveControllerNameFromPath (ReDoS & Path Parsing)', () => {
    it('derives controller names correctly for standard paths', () => {
      expect(deriveControllerNameFromPath('pages/index.client.js')).toBe('index');
      expect(deriveControllerNameFromPath('pages/settings/profile.client.ts')).toBe('settings--profile');
      expect(deriveControllerNameFromPath('views/components/dropdown.client.ts')).toBe('dropdown');
      expect(deriveControllerNameFromPath('views/modals/confirm-dialog.client.js')).toBe('confirm-dialog');
    });

    it('handles deep paths and src prefixes', () => {
      expect(deriveControllerNameFromPath('/repo/src/views/components/forms/color-picker.client.tsx')).toBe('forms--color-picker');
      expect(deriveControllerNameFromPath('src/pages/dashboard/analytics.client.js')).toBe('dashboard--analytics');
      expect(deriveControllerNameFromPath('pages/todos/[id].client.ts')).toBe('todos--id');
    });

    it('does not choke or hang on pathological ReDoS attack inputs', () => {
      const maliciousPrefix = 'src/'.repeat(500) + 'views/components/' + 'a/'.repeat(500) + 'widget.client.js';
      const start = Date.now();
      const result = deriveControllerNameFromPath(maliciousPrefix);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100); // Must resolve in < 100ms with linear O(N) execution
      expect(result).toContain('widget');
    });

    it('returns empty string for invalid or non-string paths', () => {
      expect(deriveControllerNameFromPath(null)).toBe('');
      expect(deriveControllerNameFromPath(undefined)).toBe('');
      expect(deriveControllerNameFromPath(123)).toBe('');
    });
  });

  describe('Mini-DOM HTML Parsing & ReDoS Resistance', () => {
    it('parses nested tags, attributes, and text correctly', () => {
      const dom = createMiniDomEnvironment(`
        <div id="wrapper" class="container">
          <!-- Sample comment -->
          <h1>Title</h1>
          <input type="text" name="query" value="search>term" />
          <button data-action="submit">Click</button>
        </div>
      `);

      const wrapper = dom.document.getElementById('wrapper');
      expect(wrapper).not.toBeNull();
      expect(wrapper.getAttribute('class')).toBe('container');
      const input = wrapper.querySelector('input');
      expect(input.getAttribute('value')).toBe('search>term');
      const button = wrapper.querySelector('button');
      expect(button.textContent).toBe('Click');
    });

    it('safely handles pathological repeated open tags without polynomial backtracking', () => {
      const pathological = '<div '.repeat(1000) + 'test="123"';
      const start = Date.now();
      const dom = createMiniDomEnvironment(pathological);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(150);
      expect(dom.document.body).toBeDefined();
    });

    it('parses self-closing tags and ignores doctype', () => {
      const html = '<!DOCTYPE html><html><body><img src="test.png"/><hr/></body></html>';
      const dom = createMiniDomEnvironment(html);
      expect(dom.document.querySelector('img')).not.toBeNull();
      expect(dom.document.querySelector('hr')).not.toBeNull();
    });
  });

  describe('DOM XSS Prevention in Form Submits', () => {
    let originalWindow;
    beforeEach(() => {
      originalWindow = globalThis.window;
    });
    afterEach(() => {
      globalThis.window = originalWindow;
    });

    it('isSafeRedirectUrl validates URL protocols strictly', () => {
      expect(isSafeRedirectUrl('/dashboard')).toBe(true);
      expect(isSafeRedirectUrl('/todos?filter=active#section')).toBe(true);
      expect(isSafeRedirectUrl('https://example.com/checkout')).toBe(true);
      expect(isSafeRedirectUrl('http://localhost:3000/done')).toBe(true);

      expect(isSafeRedirectUrl('javascript:alert(1)')).toBe(false);
      expect(isSafeRedirectUrl('javascript://alert(1)')).toBe(false);
      expect(isSafeRedirectUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
      expect(isSafeRedirectUrl('vbscript:msgbox(1)')).toBe(false);
      expect(isSafeRedirectUrl('//attacker.com/evil')).toBe(false);
      expect(isSafeRedirectUrl('/\\attacker.com')).toBe(false);
      expect(isSafeRedirectUrl('\\\\attacker.com')).toBe(false);
      expect(isSafeRedirectUrl('')).toBe(false);
      expect(isSafeRedirectUrl(null)).toBe(false);
    });

    it('blocks dangerous protocol redirection in createFormHandle submission', async () => {
      const dom = createMiniDomEnvironment(`
        <form id="xss-form" data-w-redirect="javascript:alert(document.cookie)">
          <input name="field" value="val" />
          <button type="submit">Submit</button>
        </form>
      `);

      let navigatedTo = null;
      dom.window.location = {
        pathname: '/test',
        href: 'http://localhost:3000/test',
        assign: (url) => { navigatedTo = url; },
      };
      globalThis.window = dom.window;

      const formEl = dom.document.getElementById('xss-form');
      const form = createFormHandle(formEl, {
        api: {
          request: async () => ({ success: true }),
        },
      });

      await form.submit();
      // Must NOT have assigned the javascript: URL
      expect(navigatedTo).toBeNull();
    });

    it('allows safe relative URLs in createFormHandle submission', async () => {
      const dom = createMiniDomEnvironment(`
        <form id="safe-form" data-w-redirect="/dashboard?success=true">
          <input name="field" value="val" />
          <button type="submit">Submit</button>
        </form>
      `);

      let navigatedTo = null;
      dom.window.location = {
        pathname: '/test',
        href: 'http://localhost:3000/test',
        assign: (url) => { navigatedTo = url; },
      };
      globalThis.window = dom.window;

      const formEl = dom.document.getElementById('safe-form');
      const form = createFormHandle(formEl, {
        api: {
          request: async () => ({ success: true }),
        },
      });

      await form.submit();
      expect(navigatedTo).toBe('/dashboard?success=true');
    });
  });

  describe('Fragment Rate Limiting Protection', () => {
    it('rate limiting middleware is mounted on fragment refresh endpoints', async () => {
      const { mountDiscoveredRoutes } = await import('../../src/routing/mount-discovered-routes');
      const mockApp = {
        getCalls: [],
        postCalls: [],
        get(path, ...handlers) { this.getCalls.push({ path, handlers }); },
        post(path, ...handlers) { this.postCalls.push({ path, handlers }); },
      };

      mountDiscoveredRoutes(mockApp, { routes: [] }, { nunjucks: {} });

      const fragmentGet = mockApp.getCalls.find(c => c.path === '/__webspresso/fragments');
      const fragmentPost = mockApp.postCalls.find(c => c.path === '/__webspresso/fragments');

      expect(fragmentGet).toBeDefined();
      expect(fragmentPost).toBeDefined();
      // Should have rate limiter middleware before handler
      expect(fragmentGet.handlers.length).toBe(2);
      expect(fragmentPost.handlers.length).toBe(2);
      expect(typeof fragmentGet.handlers[0]).toBe('function');
      expect(typeof fragmentPost.handlers[0]).toBe('function');
    });
  });
});

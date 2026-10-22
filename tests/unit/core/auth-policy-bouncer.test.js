import { createMockSpyRes, createMockSpyNext } from '../../utils';
import { describe, it, expect, beforeEach, vi } from 'vitest';
const {
  PolicyManager,
  AuthorizationError,
  definePolicy,
  defineGate,
  before,
  can,
  cannot,
  authorize,
  defaultPolicyManager,
} = require('../../../core/auth/policy');
const {
  Bouncer,
  createBouncer,
  createBouncerMiddleware,
} = require('../../../core/auth/bouncer');
const {
  getClientIp,
  parseUserAgent,
} = require('../../../core/auth/user-agent');
const {
  buildMagicLinkUrl,
  formatMagicLinkHtml,
  createMagicLinkVerifyMiddleware,
  createMagicLinkRequestHandler,
} = require('../../../core/auth/magic-link');
const { ForbiddenError, UnauthorizedError } = require('../../../core/errors');

describe('core/auth/policy.js', () => {
  let manager;

  beforeEach(() => {
    manager = new PolicyManager();
    defaultPolicyManager.clear();
  });

  describe('AuthorizationError', () => {
    it('creates instance with default and custom values', () => {
      const errDefault = new AuthorizationError();
      expect(errDefault.message).toBe('This action is unauthorized');
      expect(errDefault.name).toBe('AuthorizationError');
      expect(errDefault.action).toBeNull();
      expect(errDefault.policy).toBeNull();
      expect(errDefault.status).toBe(403);

      const errCustom = new AuthorizationError('Custom message', 'edit', 'post');
      expect(errCustom.message).toBe('Custom message');
      expect(errCustom.action).toBe('edit');
      expect(errCustom.policy).toBe('post');
    });
  });

  describe('PolicyManager - Gates', () => {
    it('validates gate callback is a function', () => {
      expect(() => manager.defineGate('invalid', 'not-a-fn')).toThrow('Gate callback must be a function');
    });

    it('defines and checks gates', () => {
      manager.defineGate('admin-only', (user) => user?.role === 'admin');
      manager.defineGate('edit-doc', (user, doc) => user?.id === doc?.ownerId);

      expect(manager.hasGate('admin-only')).toBe(true);
      expect(manager.hasGate('non-existent')).toBe(false);
      expect(manager.getGates()).toEqual(['admin-only', 'edit-doc']);

      expect(manager.can({ role: 'admin' }, 'admin-only')).toBe(true);
      expect(manager.can({ role: 'member' }, 'admin-only')).toBe(false);
      expect(manager.cannot({ role: 'member' }, 'admin-only')).toBe(true);

      const doc = { ownerId: 42 };
      expect(manager.can({ id: 42 }, 'edit-doc', null, doc)).toBe(true);
      expect(manager.can({ id: 99 }, 'edit-doc', null, doc)).toBe(false);
    });

    it('returns false when gate throws an exception', () => {
      manager.defineGate('throws-gate', () => {
        throw new Error('Gate exploded');
      });
      expect(manager.can({ id: 1 }, 'throws-gate')).toBe(false);
    });

    it('returns false for undefined gate when no policy specified', () => {
      expect(manager.can({ id: 1 }, 'unknown-gate')).toBe(false);
    });
  });

  describe('PolicyManager - Policies', () => {
    it('validates rules is an object and all rules are functions', () => {
      expect(() => manager.definePolicy('post', null)).toThrow('Policy rules must be an object');
      expect(() => manager.definePolicy('post', 'str')).toThrow('Policy rules must be an object');
      expect(() => manager.definePolicy('post', { view: 'not-fn' })).toThrow('Policy rule "view" must be a function');
    });

    it('defines and executes policy rules', () => {
      manager.definePolicy('article', {
        view: () => true,
        update: (user, article) => user?.id === article?.authorId,
        delete: (user) => user?.role === 'admin',
      });

      expect(manager.hasPolicy('article')).toBe(true);
      expect(manager.hasPolicy('missing')).toBe(false);
      expect(manager.getPolicies()).toEqual(['article']);

      const article = { authorId: 10 };
      expect(manager.can(null, 'view', 'article')).toBe(true);
      expect(manager.can({ id: 10 }, 'update', 'article', article)).toBe(true);
      expect(manager.can({ id: 11 }, 'update', 'article', article)).toBe(false);
      expect(manager.cannot({ id: 11 }, 'update', 'article', article)).toBe(true);
      expect(manager.can({ role: 'admin' }, 'delete', 'article')).toBe(true);
    });

    it('returns false and warns when policy or action is undefined', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      manager.definePolicy('post', { view: () => true });

      expect(manager.can({ id: 1 }, 'view', 'undefined-policy')).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith('Policy "undefined-policy" is not defined');

      expect(manager.can({ id: 1 }, 'edit', 'post')).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith('Action "edit" is not defined in policy "post"');

      warnSpy.mockRestore();
    });

    it('returns false when policy rule throws an exception', () => {
      manager.definePolicy('post', {
        boom: () => {
          throw new Error('policy crash');
        },
      });
      expect(manager.can({ id: 1 }, 'boom', 'post')).toBe(false);
    });
  });

  describe('PolicyManager - Before Callback & Authorize', () => {
    it('executes before callback to allow short-circuiting', () => {
      manager.definePolicy('post', {
        delete: () => false,
      });

      manager.before((user) => {
        if (user?.role === 'superadmin') return true;
        if (user?.isBanned) return false;
        return null; // continue to normal check
      });

      expect(manager.can({ role: 'superadmin' }, 'delete', 'post')).toBe(true);
      expect(manager.can({ isBanned: true }, 'delete', 'post')).toBe(false);
      expect(manager.can({ role: 'member' }, 'delete', 'post')).toBe(false);
    });

    it('authorize throws AuthorizationError on denial and passes on approval', () => {
      manager.defineGate('login-check', (user) => Boolean(user));
      manager.definePolicy('post', {
        publish: (user) => user?.isEditor === true,
      });

      expect(() => manager.authorize(null, 'login-check')).toThrow(AuthorizationError);
      expect(() => manager.authorize(null, 'login-check')).toThrow('You are not authorized to login-check');

      expect(() => manager.authorize({ isEditor: false }, 'publish', 'post')).toThrow(AuthorizationError);
      expect(() => manager.authorize({ isEditor: false }, 'publish', 'post')).toThrow(
        'You are not authorized to publish this post'
      );

      expect(() => manager.authorize({ isEditor: true }, 'publish', 'post')).not.toThrow();
    });

    it('clears all policies, gates and before callback', () => {
      manager.defineGate('g1', () => true);
      manager.definePolicy('p1', { a: () => true });
      manager.before(() => true);

      manager.clear();
      expect(manager.getGates()).toHaveLength(0);
      expect(manager.getPolicies()).toHaveLength(0);
      expect(manager.can(null, 'g1')).toBe(false);
    });

    it('delegates to defaultPolicyManager using helper functions', () => {
      defineGate('default-gate', (user) => user?.allowed === true);
      definePolicy('default-policy', { act: (user) => user?.ok === true });
      before((user) => (user?.root ? true : undefined));

      expect(can({ allowed: true }, 'default-gate')).toBe(true);
      expect(cannot({ allowed: false }, 'default-gate')).toBe(true);
      expect(can({ ok: true }, 'act', 'default-policy')).toBe(true);
      expect(can({ root: true }, 'act', 'default-policy')).toBe(true);

      expect(() => authorize({ allowed: false }, 'default-gate')).toThrow(AuthorizationError);
      expect(() => authorize({ allowed: true }, 'default-gate')).not.toThrow();
    });
  });
});

describe('core/auth/bouncer.js', () => {
  let policyManager;

  beforeEach(() => {
    policyManager = new PolicyManager();
  });

  describe('Argument Parsing (_parseArgs)', () => {
    it('parses function rules', () => {
      const bouncer = new Bouncer(null, policyManager);
      const fn = () => true;
      const res = { id: 1 };
      const parsed = bouncer._parseArgs(fn, res);

      expect(parsed.isFn).toBe(true);
      expect(parsed.fn).toBe(fn);
      expect(parsed.resource).toBe(res);
    });

    it('parses dot notation strings', () => {
      const bouncer = new Bouncer(null, policyManager);
      const res = { id: 2 };
      const parsed = bouncer._parseArgs('Post.comment.create', res);

      expect(parsed.policy).toBe('Post');
      expect(parsed.action).toBe('comment.create');
      expect(parsed.resource).toBe(res);
    });

    it('parses separate policy and action strings', () => {
      const bouncer = new Bouncer(null, policyManager);
      const res = { id: 3 };
      const parsed = bouncer._parseArgs('Post', 'delete', res);

      expect(parsed.policy).toBe('Post');
      expect(parsed.action).toBe('delete');
      expect(parsed.resource).toBe(res);
    });

    it('parses single gate / permission names and non-strings', () => {
      const bouncer = new Bouncer(null, policyManager);
      const parsedGate = bouncer._parseArgs('manage-billing', { plan: 'pro' });
      expect(parsedGate.policy).toBeNull();
      expect(parsedGate.action).toBe('manage-billing');
      expect(parsedGate.resource).toEqual({ plan: 'pro' });

      const parsedNum = bouncer._parseArgs(404, 'res');
      expect(parsedNum.policy).toBeNull();
      expect(parsedNum.action).toBe('404');
    });
  });

  describe('allows, denies & permissions', () => {
    it('supports direct function rules and catches errors', () => {
      const user = { id: 5 };
      const bouncer = new Bouncer(user, policyManager);

      expect(bouncer.allows((u, resource) => u.id === resource.ownerId, { ownerId: 5 })).toBe(true);
      expect(bouncer.allows((u, resource) => u.id === resource.ownerId, { ownerId: 6 })).toBe(false);
      expect(bouncer.denies((u, resource) => u.id === resource.ownerId, { ownerId: 6 })).toBe(true);

      const throwingRule = () => {
        throw new Error('fail');
      };
      expect(bouncer.allows(throwingRule)).toBe(false);
    });

    it('evaluates policies and gates defined on policyManager', () => {
      policyManager.definePolicy('Project', {
        archive: (user, project) => user?.id === project.leadId,
      });
      policyManager.defineGate('view-dashboard', (user) => user?.active === true);

      const user = { id: 10, active: true };
      const bouncer = new Bouncer(user, policyManager);

      expect(bouncer.allows('Project.archive', { leadId: 10 })).toBe(true);
      expect(bouncer.allows('Project', 'archive', { leadId: 99 })).toBe(false);
      expect(bouncer.allows('view-dashboard')).toBe(true);
    });

    it('evaluates user.hasPerm or user.hasPermission methods', () => {
      const userWithPerm = {
        hasPerm: (perm, resource) => perm === 'billing.view' && resource?.tenantId === 't1',
      };
      const bouncer1 = new Bouncer(userWithPerm, policyManager);
      expect(bouncer1.allows('billing.view', { tenantId: 't1' })).toBe(true);
      expect(bouncer1.allows('billing.view', { tenantId: 't2' })).toBe(false);

      const userWithPermission = {
        hasPermission: (perm) => perm === 'admin.access',
      };
      const bouncer2 = new Bouncer(userWithPermission, policyManager);
      expect(bouncer2.allows('admin.access')).toBe(true);
    });

    it('evaluates user permissions array or Set including wildcards', () => {
      const userWithArray = {
        permissions: ['order.view', 'post.*'],
      };
      const bouncerArr = new Bouncer(userWithArray, policyManager);
      expect(bouncerArr.allows('order.view')).toBe(true);
      expect(bouncerArr.allows('order.delete')).toBe(false);
      expect(bouncerArr.allows('Post.update')).toBe(true);
      expect(bouncerArr.allows('Post.delete')).toBe(true);

      const userWithSet = {
        permissions: new Set(['*']),
      };
      const bouncerSet = new Bouncer(userWithSet, policyManager);
      expect(bouncerSet.allows('anything.anywhere')).toBe(true);
    });

    it('evaluates superuser flags', () => {
      const superuser1 = { isSuperuser: true };
      const bouncer1 = new Bouncer(superuser1, policyManager);
      expect(bouncer1.allows('system.reboot')).toBe(true);

      const superuser2 = { is_superuser: true };
      const bouncer2 = new Bouncer(superuser2, policyManager);
      expect(bouncer2.allows('system.reboot')).toBe(true);

      const regularUser = { id: 1 };
      const bouncer3 = new Bouncer(regularUser, policyManager);
      expect(bouncer3.allows('system.reboot')).toBe(false);
    });

    it('returns false when user is null and no policy/gate allows it', () => {
      const bouncer = new Bouncer(null, policyManager);
      expect(bouncer.allows('some.action')).toBe(false);
    });
  });

  describe('authorize & forUser', () => {
    it('throws UnauthorizedError if user is not authenticated', () => {
      const bouncer = new Bouncer(null, policyManager);
      expect(() => bouncer.authorize('edit.profile')).toThrow(UnauthorizedError);
      expect(() => bouncer.authorize('edit.profile')).toThrow('Authentication required to perform this action');
    });

    it('throws ForbiddenError if user is authenticated but not authorized', () => {
      const user = { id: 1, permissions: [] };
      const bouncer = new Bouncer(user, policyManager);
      expect(() => bouncer.authorize('admin.delete')).toThrow(ForbiddenError);
      expect(() => bouncer.authorize('admin.delete')).toThrow('You are not authorized to perform "admin.delete"');

      // function rule label fallback
      expect(() => bouncer.authorize(() => false)).toThrow('You are not authorized to perform "action"');
    });

    it('returns true when authorized', () => {
      const user = { isSuperuser: true };
      const bouncer = new Bouncer(user, policyManager);
      expect(bouncer.authorize('any.action')).toBe(true);
    });

    it('switches subject user using forUser', () => {
      const bouncer = new Bouncer({ id: 1 }, policyManager);
      const bouncer2 = bouncer.forUser({ isSuperuser: true });

      expect(bouncer.allows('system.poweroff')).toBe(false);
      expect(bouncer2.allows('system.poweroff')).toBe(true);
    });
  });

  describe('createBouncer & createBouncerMiddleware', () => {
    it('creates bouncer instance using factory', () => {
      const b = createBouncer({ id: 7 }, policyManager);
      expect(b).toBeInstanceOf(Bouncer);
      expect(b.user.id).toBe(7);
    });

    it('attaches req.bouncer in middleware for req.user or req.auth.user', () => {
      const middleware = createBouncerMiddleware({ policyManager });
      const req1 = { user: { id: 10 } };
      const res = {};
      const next = createMockSpyNext();

      middleware(req1, res, next);
      expect(req1.bouncer).toBeInstanceOf(Bouncer);
      expect(req1.bouncer.user.id).toBe(10);
      expect(next).toHaveBeenCalledTimes(1);

      const req2 = { auth: { user: { id: 20 } } };
      middleware(req2, res, next);
      expect(req2.bouncer.user.id).toBe(20);
    });
  });
});

describe('core/auth/user-agent.js', () => {
  describe('getClientIp', () => {
    it('handles null or empty request', () => {
      expect(getClientIp(null)).toBe('127.0.0.1');
      expect(getClientIp({})).toBe('127.0.0.1');
    });

    it('extracts IP from x-forwarded-for string with multiple IPs', () => {
      const req = {
        headers: {
          'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178',
        },
      };
      expect(getClientIp(req)).toBe('203.0.113.195');
    });

    it('extracts IP from x-forwarded-for array', () => {
      const req = {
        headers: {
          'x-forwarded-for': ['198.51.100.1', '198.51.100.2'],
        },
      };
      expect(getClientIp(req)).toBe('198.51.100.1');
    });

    it('extracts IP from other headers and socket properties', () => {
      expect(getClientIp({ headers: { 'x-real-ip': '192.168.1.10' } })).toBe('192.168.1.10');
      expect(getClientIp({ ip: '10.0.0.1' })).toBe('10.0.0.1');
      expect(getClientIp({ connection: { remoteAddress: '172.16.0.5' } })).toBe('172.16.0.5');
      expect(getClientIp({ socket: { remoteAddress: '172.16.0.6' } })).toBe('172.16.0.6');
    });
  });

  describe('parseUserAgent', () => {
    it('returns empty device info for empty or invalid input', () => {
      const res = parseUserAgent('');
      expect(res.browser).toBe('Unknown');
      expect(res.os).toBe('Unknown');
      expect(res.device).toBe('unknown');
      expect(res.isMobile).toBe(false);
      expect(res.isTablet).toBe(false);
      expect(res.isDesktop).toBe(false);
      expect(res.isBot).toBe(false);

      expect(parseUserAgent(null).browser).toBe('Unknown');
    });

    it('detects common desktop browsers and operating systems', () => {
      const macChrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
      const info1 = parseUserAgent(macChrome);
      expect(info1.os).toBe('macOS 10.15.7');
      expect(info1.browser).toBe('Chrome 128');
      expect(info1.isDesktop).toBe(true);
      expect(info1.device).toBe('desktop');

      const winEdge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0';
      const info2 = parseUserAgent(winEdge);
      expect(info2.os).toBe('Windows 10/11');
      expect(info2.browser).toBe('Edge 128');
      expect(info2.isDesktop).toBe(true);

      const win7Firefox = 'Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0';
      const info3 = parseUserAgent(win7Firefox);
      expect(info3.os).toBe('Windows 7');
      expect(info3.browser).toBe('Firefox 115');

      const win8 = 'Mozilla/5.0 (Windows NT 6.2; Win64; x64)';
      expect(parseUserAgent(win8).os).toBe('Windows 8');

      const win81 = 'Mozilla/5.0 (Windows NT 6.3; Win64; x64)';
      expect(parseUserAgent(win81).os).toBe('Windows 8.1');

      const genericWin = 'Mozilla/5.0 (Windows NT 5.1; rv:11.0)';
      expect(parseUserAgent(genericWin).os).toBe('Windows');
    });

    it('detects Linux distributions and ChromeOS', () => {
      const ubuntu = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:90.0) Gecko/20100101 Firefox/90.0';
      expect(parseUserAgent(ubuntu).os).toBe('Ubuntu Linux');

      const fedora = 'Mozilla/5.0 (X11; Fedora; Linux x86_64; rv:90.0) Gecko/20100101 Firefox/90.0';
      expect(parseUserAgent(fedora).os).toBe('Fedora Linux');

      const genericLinux = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36';
      expect(parseUserAgent(genericLinux).os).toBe('Linux');

      const cros = 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      expect(parseUserAgent(cros).os).toBe('ChromeOS');
    });

    it('detects mobile devices and tablets', () => {
      const iPhone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1';
      const infoPhone = parseUserAgent(iPhone);
      expect(infoPhone.os).toBe('iOS 17.4.1');
      expect(infoPhone.browser).toBe('Safari 17');
      expect(infoPhone.device).toBe('mobile');
      expect(infoPhone.isMobile).toBe(true);
      expect(infoPhone.isTablet).toBe(false);

      const iPad = 'Mozilla/5.0 (iPad; CPU OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';
      const infoPad = parseUserAgent(iPad);
      expect(infoPad.os).toBe('iPadOS 16.5');
      expect(infoPad.device).toBe('tablet');
      expect(infoPad.isTablet).toBe(true);

      const androidPhone = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
      const infoAndroid = parseUserAgent(androidPhone);
      expect(infoAndroid.os).toBe('Android 14');
      expect(infoAndroid.isMobile).toBe(true);

      const androidTablet = 'Mozilla/5.0 (Linux; Android 13; SM-X800) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      const infoTablet = parseUserAgent(androidTablet);
      expect(infoTablet.device).toBe('tablet');
      expect(infoTablet.isTablet).toBe(true);
    });

    it('detects other browsers: Opera, Samsung, Brave, Vivaldi, IE', () => {
      const opera = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0';
      expect(parseUserAgent(opera).browser).toBe('Opera 106');

      const samsung = 'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36';
      expect(parseUserAgent(samsung).browser).toBe('Samsung Internet 23');

      const brave = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Brave/120';
      expect(parseUserAgent(brave).browser).toBe('Brave 120');

      const vivaldi = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Vivaldi/6.5.3206.50';
      expect(parseUserAgent(vivaldi).browser).toBe('Vivaldi 6');

      const msie = 'Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.1; Trident/6.0)';
      expect(parseUserAgent(msie).browser).toBe('Internet Explorer');

      const safariStandalone = 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15';
      expect(parseUserAgent(safariStandalone).browser).toBe('Safari');
    });

    it('detects search engine bots and automated crawlers', () => {
      const googlebot = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
      const infoBot = parseUserAgent(googlebot);
      expect(infoBot.isBot).toBe(true);
      expect(infoBot.device).toBe('bot');
      expect(infoBot.browser).toBe('Googlebot');

      const curl = 'curl/7.68.0';
      const infoCurl = parseUserAgent(curl);
      expect(infoCurl.isBot).toBe(true);
      expect(infoCurl.browser).toBe('curl');

      const postman = 'PostmanRuntime/7.29.0';
      expect(parseUserAgent(postman).isBot).toBe(true);
    });

    it('caches parsed results and evicts oldest when exceeding limit', () => {
      const ua1 = 'CustomUA-Test-1';
      const res1 = parseUserAgent(ua1);
      const res2 = parseUserAgent(ua1);
      expect(res1).toEqual(res2);

      // Fill cache to trigger eviction branch
      for (let i = 0; i < 520; i++) {
        parseUserAgent(`UA-Stress-Cache-Key-${i}`);
      }
      // Should still work without issues
      expect(parseUserAgent('UA-Stress-Cache-Key-519').browser).toBe('Unknown');
    });
  });
});

describe('core/auth/magic-link.js', () => {
  describe('buildMagicLinkUrl', () => {
    it('throws if token is not provided', () => {
      expect(() => buildMagicLinkUrl({})).toThrow('Token is required to build magic link URL');
    });

    it('constructs url with defaults and clean paths', () => {
      const url1 = buildMagicLinkUrl({ token: 'abc123xyz' });
      expect(url1).toContain('/auth/magic-link/verify?token=abc123xyz');

      const url2 = buildMagicLinkUrl({
        baseUrl: 'https://mysite.com/',
        path: 'verify-link',
        token: 'token+with special=chars',
      });
      expect(url2).toBe('https://mysite.com/verify-link?token=token%2Bwith%20special%3Dchars');

      const url3 = buildMagicLinkUrl({
        baseUrl: 'https://mysite.com',
        path: '/verify?source=email',
        token: 'token123',
      });
      expect(url3).toBe('https://mysite.com/verify?source=email&token=token123');
    });
  });

  describe('formatMagicLinkHtml', () => {
    it('generates HTML with recipient name and verification button', () => {
      const html = formatMagicLinkHtml({
        name: 'Alice',
        magicLinkUrl: 'https://example.com/verify?token=test',
        expiresMinutes: 30,
      });

      expect(html).toContain('Hello Alice,');
      expect(html).toContain('https://example.com/verify?token=test');
      expect(html).toContain('30 minutes');
      expect(html).toContain('<!DOCTYPE html>');
    });

    it('uses fallback defaults for name and expiration', () => {
      const html = formatMagicLinkHtml({
        magicLinkUrl: 'https://example.com/verify?token=test',
      });
      expect(html).toContain('Hello there,');
      expect(html).toContain('15 minutes');
    });
  });

  describe('createMagicLinkVerifyMiddleware', () => {
    let mockAuthManager;

    beforeEach(() => {
      mockAuthManager = {
        verifyMagicLink: vi.fn(),
        generateUserToken: vi.fn().mockReturnValue('mock-jwt-access'),
        generateRefreshToken: vi.fn().mockReturnValue('mock-jwt-refresh'),
      };
    });

    it('handles missing token for API request and HTML GET request', async () => {
      const middleware = createMagicLinkVerifyMiddleware(mockAuthManager, {
        failureRedirect: '/auth/fail',
      });

      // API request (missing token)
      const reqApi = { query: {}, accepts: () => false };
      const resApi = createMockSpyRes();
      await middleware(reqApi, resApi);
      expect(resApi.status).toHaveBeenCalledWith(400);
      expect(resApi.json).toHaveBeenCalledWith({ error: 'Missing magic link token' });

      // HTML GET request (missing token)
      const reqHtml = { query: {}, method: 'GET', accepts: (type) => type === 'html' };
      const resHtml = { redirect: vi.fn() };
      await middleware(reqHtml, resHtml);
      expect(resHtml.redirect).toHaveBeenCalledWith('/auth/fail');
    });

    it('handles successful verification for API request', async () => {
      const user = { id: 1, email: 'user@example.com' };
      mockAuthManager.verifyMagicLink.mockResolvedValue({ user });

      const middleware = createMagicLinkVerifyMiddleware(mockAuthManager, { jwt: true });
      const req = {
        query: { token: 'valid-token' },
        auth: { login: vi.fn().mockResolvedValue() },
      };
      const res = createMockSpyRes();

      await middleware(req, res);

      expect(mockAuthManager.verifyMagicLink).toHaveBeenCalledWith('valid-token', { markEmailVerified: true });
      expect(req.auth.login).toHaveBeenCalledWith(user);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        user,
        accessToken: 'mock-jwt-access',
        refreshToken: 'mock-jwt-refresh',
      });
    });

    it('handles successful verification for HTML GET request with redirect', async () => {
      const user = { id: 2 };
      mockAuthManager.verifyMagicLink.mockResolvedValue({ user });

      const middleware = createMagicLinkVerifyMiddleware(mockAuthManager, {
        redirectTo: '/dashboard',
      });
      const req = {
        body: { token: 'valid-token' },
        method: 'GET',
        accepts: (type) => type === 'html',
      };
      const res = { redirect: vi.fn() };

      await middleware(req, res);
      expect(res.redirect).toHaveBeenCalledWith('/dashboard');
    });

    it('handles verification error for API and HTML GET request', async () => {
      const error = new Error('Token expired');
      error.code = 'TOKEN_EXPIRED';
      mockAuthManager.verifyMagicLink.mockRejectedValue(error);

      const middleware = createMagicLinkVerifyMiddleware(mockAuthManager, {
        failureRedirect: '/login-error',
      });

      // API request failure
      const reqApi = { query: { token: 'expired' } };
      const resApi = createMockSpyRes();
      await middleware(reqApi, resApi);
      expect(resApi.status).toHaveBeenCalledWith(400);
      expect(resApi.json).toHaveBeenCalledWith({
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
      });

      // HTML GET request failure
      const reqHtml = {
        query: { token: 'expired' },
        method: 'GET',
        accepts: (type) => type === 'html',
      };
      const resHtml = { redirect: vi.fn() };
      await middleware(reqHtml, resHtml);
      expect(resHtml.redirect).toHaveBeenCalledWith('/login-error');
    });
  });

  describe('createMagicLinkRequestHandler', () => {
    let mockAuthManager;

    beforeEach(() => {
      mockAuthManager = {
        requestMagicLink: vi.fn(),
      };
    });

    it('returns 400 when email or identifier is missing', async () => {
      const handler = createMagicLinkRequestHandler(mockAuthManager);
      const req = { body: {}, query: {} };
      const res = createMockSpyRes();

      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Email or identifier is required' });
    });

    it('requests magic link and returns 200 with expiresAt', async () => {
      const expiresAt = new Date().toISOString();
      mockAuthManager.requestMagicLink.mockResolvedValue({ expiresAt });

      const handler = createMagicLinkRequestHandler(mockAuthManager, { ttl: 900 });
      const req = { body: { email: 'test@example.com' } };
      const res = createMockSpyRes();

      await handler(req, res);
      expect(mockAuthManager.requestMagicLink).toHaveBeenCalledWith('test@example.com', { ttl: 900 });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        message: 'If the account exists, a magic link has been sent.',
        expiresAt,
      });
    });

    it('returns 500 when authManager.requestMagicLink throws', async () => {
      mockAuthManager.requestMagicLink.mockRejectedValue(new Error('SMTP connection error'));

      const handler = createMagicLinkRequestHandler(mockAuthManager);
      const req = { query: { email: 'fail@example.com' } };
      const res = createMockSpyRes();

      await handler(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'SMTP connection error' });
    });
  });
});

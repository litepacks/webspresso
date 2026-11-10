/**
 * Unit & Integration Tests for Webspresso Security Shield Plugin
 */

const express = require('express');
const request = require('supertest');
const {
  securityPlugin,
  createSecurityHeadersMiddleware,
  createFirewallMiddleware,
  FirewallManager,
  IncidentRecorder,
  auditSecurityPosture,
} = require('../../../plugins/security');
const { matchIpOrCidr, normalizeIp } = require('../../../plugins/security/firewall');
const { createHoneypotMiddleware } = require('../../../plugins/security/honeypot');
const { createBruteForceMiddleware } = require('../../../plugins/security/bruteforce');
const { createSecurityServices } = require('../../../core/services/builtins/security');
const { createSecurityApiHandlers } = require('../../../plugins/security/api-handlers');

describe('Webspresso Security Shield Plugin', () => {
  describe('Security Headers (Helmet Alternative)', () => {
    it('sets standard security headers and strips X-Powered-By', async () => {
      const app = express();
      app.use((req, res, next) => {
        res.setHeader('X-Powered-By', 'Express');
        next();
      });
      app.use(createSecurityHeadersMiddleware({
        hsts: { force: true, maxAge: 31536000 },
        frameGuard: 'SAMEORIGIN',
        noSniff: true,
        referrerPolicy: 'strict-origin-when-cross-origin',
      }));

      app.get('/test', (req, res) => res.send('OK'));

      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(res.headers['x-xss-protection']).toBe('0');
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
      expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    });

    it('generates cryptographic CSP nonce when requested', async () => {
      const app = express();
      app.use(createSecurityHeadersMiddleware({
        generateNonce: true,
      }));
      app.get('/nonce', (req, res) => {
        res.json({ nonce: req.cspNonce });
      });

      const res = await request(app).get('/nonce');
      expect(res.status).toBe(200);
      expect(res.body.nonce).toBeDefined();
      expect(typeof res.body.nonce).toBe('string');
      expect(res.headers['content-security-policy']).toContain(`'nonce-${res.body.nonce}'`);
    });
  });

  describe('Firewall & CIDR Subnet Matching', () => {
    it('accurately normalizes IPv6 and IPv4-mapped addresses', () => {
      expect(normalizeIp('::1')).toBe('127.0.0.1');
      expect(normalizeIp('::ffff:192.168.1.10')).toBe('192.168.1.10');
      expect(normalizeIp('10.0.0.1 ')).toBe('10.0.0.1');
    });

    it('matches exact IPs and CIDR subnets correctly', () => {
      expect(matchIpOrCidr('192.168.1.45', '192.168.1.0/24')).toBe(true);
      expect(matchIpOrCidr('192.168.2.1', '192.168.1.0/24')).toBe(false);
      expect(matchIpOrCidr('10.50.100.200', '10.0.0.0/8')).toBe(true);
      expect(matchIpOrCidr('172.16.0.5', '172.16.0.5')).toBe(true);
      expect(matchIpOrCidr('172.16.0.6', '172.16.0.5')).toBe(false);
    });

    it('manages manual bans, expirations, and permanent bans', () => {
      const firewall = new FirewallManager();

      expect(firewall.isBanned('1.2.3.4').banned).toBe(false);

      // Temporary ban
      firewall.ban('1.2.3.4', { reason: 'suspicious_traffic', duration: 1000 });
      const check1 = firewall.isBanned('1.2.3.4');
      expect(check1.banned).toBe(true);
      expect(check1.reason).toBe('suspicious_traffic');
      expect(check1.isPermanent).toBe(false);

      // Permanent ban
      firewall.ban('5.6.7.8', { reason: 'malicious_bot', duration: 'permanent' });
      const check2 = firewall.isBanned('5.6.7.8');
      expect(check2.banned).toBe(true);
      expect(check2.isPermanent).toBe(true);

      // Unban
      expect(firewall.unban('1.2.3.4')).toBe(true);
      expect(firewall.isBanned('1.2.3.4').banned).toBe(false);
    });

    it('respects whitelist and protects whitelisted IPs from being banned', () => {
      const firewall = new FirewallManager({
        whitelist: ['127.0.0.1', '10.0.0.0/8'],
      });

      expect(firewall.isWhitelisted('127.0.0.1')).toBe(true);
      expect(firewall.isWhitelisted('10.1.2.3')).toBe(true);
      expect(firewall.isWhitelisted('8.8.8.8')).toBe(false);

      // Attempting to ban whitelisted IP should throw
      expect(() => {
        firewall.ban('127.0.0.1', { reason: 'test' });
      }).toThrow(/Cannot ban whitelisted IP/);
    });

    it('triggers auto-ban when violation threshold is reached', () => {
      const firewall = new FirewallManager({
        autoBan: {
          enabled: true,
          threshold: 3,
          window: '1m',
          duration: '1h',
        },
      });

      const ip = '198.51.100.1';
      expect(firewall.recordViolation(ip, { type: 'scan' }).autoBanned).toBe(false);
      expect(firewall.recordViolation(ip, { type: 'scan' }).autoBanned).toBe(false);
      const res3 = firewall.recordViolation(ip, { type: 'scan' });

      expect(res3.autoBanned).toBe(true);
      expect(res3.banned).toBe(true);
      expect(firewall.isBanned(ip).banned).toBe(true);
    });
  });

  describe('Honeypot Traps & Exploit Defense', () => {
    let firewall;
    let incidentRecorder;
    let app;

    beforeEach(() => {
      firewall = new FirewallManager({ autoBan: { threshold: 3 } });
      incidentRecorder = new IncidentRecorder();
      app = express();
      app.use(createFirewallMiddleware(firewall));
      app.use(createHoneypotMiddleware({
        firewall,
        incidentRecorder,
        honeypots: ['/.env', '/wp-admin'],
        detectTraversal: true,
        blockBadBots: true,
      }));
      app.get('/api/healthy', (req, res) => res.json({ ok: true }));
    });

    it('blocks access to honeypot routes and records incident', async () => {
      const res = await request(app).get('/.env');
      expect(res.status).toBe(404);

      const incidents = incidentRecorder.list();
      expect(incidents.total).toBe(1);
      expect(incidents.items[0].type).toBe('honeypot');
      expect(incidents.items[0].path).toBe('/.env');
    });

    it('detects and rejects path traversal sequences', async () => {
      const res = await request(app).get('/api/download?file=../../etc/passwd');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');

      const incidents = incidentRecorder.list();
      expect(incidents.items.some(i => i.type === 'path_traversal')).toBe(true);
    });

    it('detects and blocks automated security scanners', async () => {
      const res = await request(app)
        .get('/api/healthy')
        .set('User-Agent', 'sqlmap/1.5#stable');

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Automated vulnerability scanner');

      const incidents = incidentRecorder.list();
      expect(incidents.items.some(i => i.type === 'bad_bot')).toBe(true);
    });
  });

  describe('Brute-Force Guard', () => {
    it('throttles repeated failed login attempts and triggers 429 lockout', async () => {
      const firewall = new FirewallManager();
      const incidentRecorder = new IncidentRecorder();
      const app = express();
      app.use(express.json());
      app.use(createBruteForceMiddleware({
        firewall,
        incidentRecorder,
        routes: ['/login'],
        maxAttempts: 3,
        window: '5m',
        lockout: '5m',
        progressiveDelay: false,
      }));

      // Dummy login route
      app.post('/login', (req, res) => {
        if (req.body.password !== 'secret123') {
          return res.status(401).json({ error: 'Invalid credentials' });
        }
        res.json({ token: 'abc' });
      });

      // 1st failed attempt
      const res1 = await request(app).post('/login').send({ password: 'wrong' });
      expect(res1.status).toBe(401);

      // 2nd failed attempt
      const res2 = await request(app).post('/login').send({ password: 'wrong' });
      expect(res2.status).toBe(401);

      // 3rd failed attempt - triggers lockout
      const res3 = await request(app).post('/login').send({ password: 'wrong' });
      expect(res3.status).toBe(401);

      // 4th attempt - now locked out with 429
      const res4 = await request(app).post('/login').send({ password: 'wrong' });
      expect(res4.status).toBe(429);
      expect(res4.body.error).toBe('Too Many Requests');
      expect(res4.headers['retry-after']).toBeDefined();
    });
  });

  describe('Security Admin API & Posture Audit', () => {
    let firewall;
    let incidentRecorder;
    let handlers;
    let app;

    beforeEach(() => {
      firewall = new FirewallManager();
      incidentRecorder = new IncidentRecorder();
      handlers = createSecurityApiHandlers({
        firewall,
        incidentRecorder,
        options: {
          headers: { csp: true, hsts: true },
          firewall: true,
          honeypot: true,
          bruteForce: true,
        },
      });

      app = express();
      app.use(express.json());
      app.get('/stats', handlers.getStatsHandler);
      app.get('/banned', handlers.listBannedIpsHandler);
      app.post('/ban', handlers.banIpHandler);
      app.post('/unban', handlers.unbanIpHandler);
      app.get('/incidents', handlers.listIncidentsHandler);
      app.post('/clear-incidents', handlers.clearIncidentsHandler);
      app.get('/audit', handlers.getAuditHandler);
    });

    it('evaluates security posture audit with score and checklist', async () => {
      const res = await request(app).get('/audit');
      expect(res.status).toBe(200);
      expect(res.body.score).toBeGreaterThanOrEqual(80);
      expect(res.body.grade).toMatch(/A|B/);
      expect(Array.isArray(res.body.checks)).toBe(true);
      expect(res.body.totalChecks).toBeGreaterThan(0);
    });

    it('performs ban and unban workflow via REST API', async () => {
      // 1. Ban IP
      const banRes = await request(app).post('/ban').send({
        ip: '203.0.113.50',
        reason: 'Malicious abuse test',
        duration: '1h',
      });
      expect(banRes.status).toBe(201);
      expect(banRes.body.status).toBe('ok');
      expect(banRes.body.ban.ip).toBe('203.0.113.50');

      // 2. Check list
      const listRes = await request(app).get('/banned');
      expect(listRes.status).toBe(200);
      expect(listRes.body.total).toBe(1);
      expect(listRes.body.items[0].ip).toBe('203.0.113.50');

      // 3. Unban IP
      const unbanRes = await request(app).post('/unban').send({
        ip: '203.0.113.50',
      });
      expect(unbanRes.status).toBe(200);
      expect(unbanRes.body.message).toContain('unbanned successfully');

      // 4. Verify unbanned
      const listAfter = await request(app).get('/banned');
      expect(listAfter.body.total).toBe(0);
    });

    it('retrieves stats and manages incident logs', async () => {
      incidentRecorder.record({
        type: 'honeypot',
        ip: '192.0.2.1',
        path: '/.env',
        actionTaken: 'blocked',
      });

      const statsRes = await request(app).get('/stats');
      expect(statsRes.status).toBe(200);
      const statsBody = statsRes.body?.status ? statsRes.body : JSON.parse(statsRes.text);
      expect(statsBody.status).toBe('ok');
      expect(statsBody.incidents24h).toBe(1);

      const incidentsRes = await request(app).get('/incidents');
      expect(incidentsRes.status).toBe(200);
      expect(incidentsRes.body.total).toBe(1);

      const clearRes = await request(app).post('/clear-incidents');
      expect(clearRes.status).toBe(200);

      const afterClear = await request(app).get('/incidents');
      expect(afterClear.body.total).toBe(0);
    });
  });

  describe('Built-in Framework Security Services', () => {
    it('executes security services correctly', async () => {
      const firewall = new FirewallManager();
      const incidentRecorder = new IncidentRecorder();
      const services = createSecurityServices({ firewall, incidentRecorder });

      // 1. security.ban service
      const banResult = await services['security.ban'].handler({
        ip: '198.51.100.99',
        reason: 'Service ban test',
        duration: '2h',
      });
      expect(banResult.ip).toBe('198.51.100.99');

      // 2. security.check-ip service
      const checkResult = await services['security.check-ip'].handler({ ip: '198.51.100.99' });
      expect(checkResult.banned).toBe(true);

      // 3. security.stats service
      const stats = await services['security.stats'].handler();
      expect(stats.activeBans).toBe(1);

      // 4. security.unban service
      const unbanResult = await services['security.unban'].handler({ ip: '198.51.100.99' });
      expect(unbanResult.success).toBe(true);
    });
  });
});

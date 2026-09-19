/**
 * Security Test Suite: File Manager Security & Hardening
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { createApp } from '../../src/server.js';
import { createDatabase } from '../../core/orm/index.js';
import { adminPanelPlugin } from '../../plugins/admin-panel/index.js';
import fileManagerPlugin from '../../plugins/file-manager/index.js';
import { clearRegistry } from '../../core/orm/model.js';
import { hash } from '../../core/auth/hash.js';
import {
  validateSafeExtension,
  validateMagicBytes,
  sanitizeSvgContent,
} from '../../plugins/file-manager/security';

describe('Security: File Manager Hardening & Threat Mitigations', () => {
  let tmpDir;
  let uploadDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-fm-sec-'));
    uploadDir = path.join(tmpDir, 'public', 'uploads');
    await fs.mkdir(uploadDir, { recursive: true });
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  describe('1. Dangerous Extensions & Double Extension Mitigation', () => {
    it('blocks dangerous executable and script extensions', () => {
      const dangerousList = ['shell.php', 'exploit.phtml', 'malware.exe', 'script.sh', 'backdoor.jsp', 'config.env'];
      for (const file of dangerousList) {
        expect(() => validateSafeExtension(file)).toThrow(/Dangerous|forbidden/i);
      }
    });

    it('blocks double extension bypass attempts', () => {
      const doubleExtensions = ['avatar.php.jpg', 'invoice.pdf.exe', 'data.sh.png', 'photo.php.png'];
      for (const file of doubleExtensions) {
        expect(() => validateSafeExtension(file)).toThrow(/Dangerous extension or double-extension/i);
      }
    });

    it('allows clean, safe extensions with multiple harmless dots', () => {
      expect(validateSafeExtension('my.vacation.photo.jpg')).toBe('jpg');
      expect(validateSafeExtension('annual.financial.report.2026.pdf')).toBe('pdf');
    });
  });

  describe('2. Magic Bytes (File Signature) Verification', () => {
    it('rejects files claiming to be JPEG/PNG/PDF but with invalid magic bytes', () => {
      const fakeJpeg = Buffer.from('<?php echo "evil"; ?>');
      expect(() => validateMagicBytes(fakeJpeg, 'jpg')).toThrow(/File signature mismatch/i);

      const fakePng = Buffer.from('MZ\x90\x00\x03\x00\x00\x00'); // Windows PE header
      expect(() => validateMagicBytes(fakePng, 'png')).toThrow(/File signature mismatch/i);

      const fakePdf = Buffer.from('<html><body>Fake PDF</body></html>');
      expect(() => validateMagicBytes(fakePdf, 'pdf')).toThrow(/File signature mismatch/i);
    });

    it('accepts genuine magic bytes for binary files', () => {
      const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      expect(validateMagicBytes(validJpeg, 'jpg')).toBe(true);

      const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
      expect(validateMagicBytes(validPng, 'png')).toBe(true);

      const validPdf = Buffer.from('%PDF-1.7 header content here');
      expect(validateMagicBytes(validPdf, 'pdf')).toBe(true);
    });
  });

  describe('3. SVG Stored XSS Sanitization', () => {
    it('strips <script>, <iframe>, <foreignObject> and on* handlers from SVG files', () => {
      const dirtySvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" onload="alert('xss')">
          <circle cx="50" cy="50" r="40" stroke="green" stroke-width="4" fill="yellow" onclick="stealCookies()" />
          <script>fetch('/_admin/api/auth/token').then(r => r.text()).then(t => alert(t));</script>
          <foreignObject width="100" height="50">
            <body xmlns="http://www.w3.org/1999/xhtml"><script>alert(2)</script></body>
          </foreignObject>
          <a href="javascript:alert(3)">Click me</a>
        </svg>
      `;

      const sanitizedBuffer = sanitizeSvgContent(dirtySvg);
      const sanitized = sanitizedBuffer.toString('utf8');

      expect(sanitized).not.toContain('<script');
      expect(sanitized).not.toContain('alert(');
      expect(sanitized).not.toContain('onload=');
      expect(sanitized).not.toContain('onclick=');
      expect(sanitized).not.toContain('<foreignObject');
      expect(sanitized).not.toContain('javascript:');
      expect(sanitized).toContain('<circle');
    });

    it('preserves clean SVG vectors untouched', () => {
      const cleanSvg = '<svg width="10" height="10"><rect width="10" height="10" fill="red" /></svg>';
      const sanitized = sanitizeSvgContent(cleanSvg).toString('utf8');
      expect(sanitized).toBe(cleanSvg);
    });
  });

  describe('4. RBAC & Storage Quota Enforcement via API', () => {
    let app;
    let db;

    beforeEach(async () => {
      clearRegistry();
      db = createDatabase({
        client: 'better-sqlite3',
        connection: ':memory:',
        useNullAsDefault: true,
        models: './tests/fixtures/models-empty',
      });

      await db.knex.schema.createTable('admin_users', (table) => {
        table.bigIncrements('id');
        table.string('email').unique();
        table.string('password');
        table.string('name');
        table.string('role').defaultTo('admin');
        table.boolean('active').defaultTo(true);
        table.timestamp('created_at');
        table.timestamp('updated_at');
      });

      const hashedPassword = await hash('password123', 4);
      await db.knex('admin_users').insert({
        email: 'admin@example.com',
        password: hashedPassword,
        name: 'Admin User',
        role: 'admin',
        active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const emptyPagesDir = path.join(__dirname, '../fixtures/empty-pages');
      await fs.mkdir(emptyPagesDir, { recursive: true });

      const result = createApp({
        pagesDir: emptyPagesDir,
        viewsDir: './tests/fixtures/views',
        publicDir: path.join(tmpDir, 'public'),
        plugins: [
          fileManagerPlugin({
            baseDir: uploadDir,
            maxTotalStorageBytes: 500, // Very small quota (500 bytes) for testing
            permissions: {
              delete: ['admin'], // Only admin can delete
              upload: ['admin', 'editor'],
            },
          }),
          adminPanelPlugin({ db }),
        ],
      });
      app = result.app;
    });

    afterEach(async () => {
      if (db) await db.destroy();
      clearRegistry();
    });

    it('rejects uploads exceeding storage quota with 507', async () => {
      const loginRes = await request(app).post('/_admin/api/auth/login').send({
        email: 'admin@example.com',
        password: 'password123',
      });
      const cookie = loginRes.headers['set-cookie'];

      // Upload file larger than 500 bytes quota
      const largeBuffer = Buffer.alloc(600, 'A');
      const res = await request(app)
        .post('/_admin/api/files/upload')
        .set('Cookie', cookie)
        .attach('files', largeBuffer, 'big.txt')
        .expect(507);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Storage quota exceeded');
    });
  });
});

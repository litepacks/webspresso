/**
 * Unit tests for File Manager Security Subsystem
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import {
  DANGEROUS_EXTENSIONS,
  MAGIC_NUMBERS,
  validateSafeExtension,
  validateMagicBytes,
  sanitizeSvgContent,
} from '../../../plugins/file-manager/security';
import { SecurityError, ValidationError } from '../../../core/errors';

describe('File Manager Security Subsystem', () => {
  describe('DANGEROUS_EXTENSIONS list & MAGIC_NUMBERS', () => {
    it('contains all critical executable and script extensions', () => {
      const critical = ['php', 'exe', 'sh', 'bat', 'cmd', 'ps1', 'jsp', 'asp', 'cgi', 'env', 'htaccess'];
      for (const ext of critical) {
        expect(DANGEROUS_EXTENSIONS.has(ext)).toBe(true);
      }
    });

    it('contains magic byte validators for common binary formats', () => {
      const binaryFormats = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'zip', 'docx', 'xlsx', 'mp3', 'mp4'];
      for (const fmt of binaryFormats) {
        expect(typeof MAGIC_NUMBERS[fmt]).toBe('function');
      }
    });
  });

  describe('validateSafeExtension', () => {
    it('throws ValidationError for empty or missing filename', () => {
      expect(() => validateSafeExtension('')).toThrow(ValidationError);
      expect(() => validateSafeExtension(null)).toThrow(ValidationError);
      expect(() => validateSafeExtension(undefined)).toThrow(ValidationError);
      expect(() => validateSafeExtension('   ')).toThrow(ValidationError);
    });

    it('throws ValidationError when filename has no extension', () => {
      expect(() => validateSafeExtension('myfile')).toThrow('Filename must have a valid extension');
    });

    it('throws SecurityError when final extension is dangerous', () => {
      expect(() => validateSafeExtension('shell.php')).toThrow(SecurityError);
      expect(() => validateSafeExtension('installer.EXE')).toThrow(SecurityError);
      expect(() => validateSafeExtension('script.sh')).toThrow(SecurityError);
      expect(() => validateSafeExtension('.env')).toThrow(SecurityError);
    });

    it('throws SecurityError when intermediate extension is dangerous (double-extension attack)', () => {
      expect(() => validateSafeExtension('avatar.php.jpg')).toThrow(
        /Dangerous extension or double-extension detected: .php/
      );
      expect(() => validateSafeExtension('doc.exe.png')).toThrow(
        /Dangerous extension or double-extension detected: .exe/
      );
      expect(() => validateSafeExtension('archive.sh.tar.gz')).toThrow(
        /Dangerous extension or double-extension detected: .sh/
      );
    });

    it('returns clean lowercase extension for valid filenames', () => {
      expect(validateSafeExtension('photo.PNG')).toBe('png');
      expect(validateSafeExtension('document.v1.2.pdf')).toBe('pdf');
      expect(validateSafeExtension('archive.tar.gz')).toBe('gz');
      expect(validateSafeExtension('my-image.JPEG')).toBe('jpeg');
    });
  });

  describe('validateMagicBytes', () => {
    it('throws ValidationError when buffer is missing or invalid', () => {
      expect(() => validateMagicBytes(null, 'jpg')).toThrow(ValidationError);
      expect(() => validateMagicBytes('not-a-buffer', 'png')).toThrow(ValidationError);
    });

    it('verifies JPEG / JPG magic bytes', () => {
      const validJpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
      expect(validateMagicBytes(validJpg, 'jpg')).toBe(true);
      expect(validateMagicBytes(validJpg, '.jpeg')).toBe(true);

      const invalidJpg = Buffer.from([0x00, 0x00, 0x00, 0x00]);
      expect(() => validateMagicBytes(invalidJpg, 'jpg')).toThrow(SecurityError);
    });

    it('verifies PNG magic bytes', () => {
      const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
      expect(validateMagicBytes(validPng, 'png')).toBe(true);

      const invalidPng = Buffer.from([0x89, 0x50, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      expect(() => validateMagicBytes(invalidPng, 'png')).toThrow(SecurityError);
    });

    it('verifies GIF magic bytes (GIF87a & GIF89a)', () => {
      const validGif87 = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
      const validGif89 = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
      expect(validateMagicBytes(validGif87, 'gif')).toBe(true);
      expect(validateMagicBytes(validGif89, 'gif')).toBe(true);

      const invalidGif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x30, 0x61]);
      expect(() => validateMagicBytes(invalidGif, 'gif')).toThrow(SecurityError);
    });

    it('verifies WebP magic bytes (RIFF....WEBP)', () => {
      const validWebp = Buffer.alloc(16);
      validWebp.write('RIFF', 0);
      validWebp.write('WEBP', 8);
      expect(validateMagicBytes(validWebp, 'webp')).toBe(true);

      const invalidWebp = Buffer.alloc(16);
      invalidWebp.write('RIFF', 0);
      invalidWebp.write('FAIL', 8);
      expect(() => validateMagicBytes(invalidWebp, 'webp')).toThrow(SecurityError);
    });

    it('verifies PDF magic bytes (%PDF-)', () => {
      const validPdf = Buffer.from('%PDF-1.7\n');
      expect(validateMagicBytes(validPdf, 'pdf')).toBe(true);

      const invalidPdf = Buffer.from('NOT-A-PDF');
      expect(() => validateMagicBytes(invalidPdf, 'pdf')).toThrow(SecurityError);
    });

    it('verifies ZIP / Office magic bytes (PK..)', () => {
      const validZip = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      expect(validateMagicBytes(validZip, 'zip')).toBe(true);
      expect(validateMagicBytes(validZip, 'docx')).toBe(true);
      expect(validateMagicBytes(validZip, 'xlsx')).toBe(true);
      expect(validateMagicBytes(validZip, 'pptx')).toBe(true);

      const invalidZip = Buffer.from([0x50, 0x4b, 0x00, 0x00]);
      expect(() => validateMagicBytes(invalidZip, 'zip')).toThrow(SecurityError);
    });

    it('verifies MP3 and MP4 magic bytes', () => {
      const id3Mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04]);
      expect(validateMagicBytes(id3Mp3, 'mp3')).toBe(true);

      const validMp4 = Buffer.alloc(12);
      validMp4.write('ftyp', 4);
      expect(validateMagicBytes(validMp4, 'mp4')).toBe(true);
    });

    it('passes unknown extensions without error', () => {
      const txtBuffer = Buffer.from('hello world');
      expect(validateMagicBytes(txtBuffer, 'txt')).toBe(true);
    });
  });

  describe('sanitizeSvgContent', () => {
    it('strips script tags and inline event handlers while preserving safe SVG tags', () => {
      const maliciousSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="red" onclick="alert('XSS')" />
          <script>alert(document.cookie)</script>
          <foreignObject width="100" height="100">
            <iframe src="http://evil.com"></iframe>
          </foreignObject>
        </svg>
      `;

      const sanitizedBuffer = sanitizeSvgContent(maliciousSvg);
      const sanitizedStr = sanitizedBuffer.toString('utf8');

      expect(sanitizedStr).toContain('<svg');
      expect(sanitizedStr).toContain('<circle');
      expect(sanitizedStr).toContain('cx="50"');
      expect(sanitizedStr).toContain('fill="red"');

      // Unsafe tags and attributes must be removed
      expect(sanitizedStr).not.toContain('<script');
      expect(sanitizedStr).not.toContain('alert(');
      expect(sanitizedStr).not.toContain('onclick');
      expect(sanitizedStr).not.toContain('<foreignObject');
      expect(sanitizedStr).not.toContain('<iframe');
    });

    it('handles Buffer input directly', () => {
      const svgBuf = Buffer.from('<svg><rect width="10" height="10"/></svg>');
      const res = sanitizeSvgContent(svgBuf);
      expect(Buffer.isBuffer(res)).toBe(true);
      expect(res.toString('utf8')).toContain('<rect');
    });
  });
});

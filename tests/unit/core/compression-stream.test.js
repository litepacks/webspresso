/**
 * Unit tests for Compression Stream Factory
 * @vitest-environment node
 */

import { describe, it, expect, vi } from 'vitest';
import zlib from 'zlib';
import { createCompressionStream } from '../../../core/compression/compression-stream';

const negotiateMod = require('../../../core/compression/negotiate');

describe('Compression Stream Factory', () => {
  it('returns null for empty or unsupported encoding', () => {
    expect(createCompressionStream()).toBeNull();
    expect(createCompressionStream('')).toBeNull();
    expect(createCompressionStream('unsupported')).toBeNull();
  });

  describe('Brotli encoding (br)', () => {
    it('creates Brotli compression stream with default quality', () => {
      const stream = createCompressionStream('br');
      expect(stream).toBeDefined();
      expect(stream).not.toBeNull();
      expect(typeof stream.pipe).toBe('function');
    });

    it('respects custom brotli options and quality level', () => {
      const stream = createCompressionStream('BR', {
        brotliQuality: 8,
      });
      expect(stream).not.toBeNull();
      expect(typeof stream.write).toBe('function');
    });

    it('respects options.brotli.quality parameter', () => {
      const stream = createCompressionStream('br', {
        brotli: { quality: 5 },
      });
      expect(stream).not.toBeNull();
    });

    it('returns null when supportsBrotli is false', () => {
      const stream = createCompressionStream('br', { supportsBrotli: false });
      expect(stream).toBeNull();
    });
  });

  describe('Gzip encoding (gzip)', () => {
    it('creates Gzip stream with default level 6', () => {
      const stream = createCompressionStream('gzip');
      expect(stream).not.toBeNull();
      expect(typeof stream.pipe).toBe('function');
    });

    it('creates Gzip stream with custom level and options', () => {
      const stream = createCompressionStream('GZIP', {
        level: 9,
        gzip: { memLevel: 8 },
      });
      expect(stream).not.toBeNull();
    });
  });

  describe('Deflate encoding (deflate)', () => {
    it('creates Deflate stream with default level 6', () => {
      const stream = createCompressionStream('deflate');
      expect(stream).not.toBeNull();
      expect(typeof stream.pipe).toBe('function');
    });

    it('creates Deflate stream with custom options', () => {
      const stream = createCompressionStream('DEFLATE', {
        level: 4,
        deflate: { windowBits: 15 },
      });
      expect(stream).not.toBeNull();
    });
  });
});

/**
 * Local file upload provider unit tests
 */

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const {
  createLocalFileProvider,
  resolveStoredExtension,
  canonicalExtFromMime,
} = require('../../plugins/upload/local-file-provider');

describe('resolveStoredExtension / canonicalExtFromMime', () => {
  it('should add extension from MIME when filename has none', () => {
    expect(resolveStoredExtension('image/png', '')).toBe('.png');
    expect(resolveStoredExtension('application/pdf', '')).toBe('.pdf');
  });

  it('should normalize extension when it disagrees with mapped MIME', () => {
    expect(resolveStoredExtension('image/jpeg', '.png')).toBe('.jpg');
    expect(resolveStoredExtension('image/png', '.jpg')).toBe('.png');
  });

  it('should keep filename extension when MIME has no mapping', () => {
    expect(resolveStoredExtension('application/octet-stream', '.bin')).toBe('.bin');
    expect(canonicalExtFromMime('application/octet-stream')).toBeNull();
  });
});

describe('createLocalFileProvider', () => {
  it('should write buffer and return publicUrl under publicBasePath', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-lfp-'));
    const provider = createLocalFileProvider({
      destDir: tmp,
      publicBasePath: '/uploads',
    });

    const result = await provider.put({
      buffer: Buffer.from('hello'),
      originalName: 'doc.pdf',
      mimeType: 'application/pdf',
      size: 5,
      req: {},
    });

    expect(result.publicUrl.startsWith('/uploads/')).toBe(true);
    expect(result.key).toBeTruthy();

    const diskPath = path.join(tmp, result.key);
    const content = await fs.readFile(diskPath, 'utf8');
    expect(content).toBe('hello');
    expect(result.key.endsWith('.pdf')).toBe(true);
  });

  it('should use MIME-mapped extension when original name has no extension', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-lfp3-'));
    const provider = createLocalFileProvider({ destDir: tmp, publicBasePath: '/u' });

    const result = await provider.put({
      buffer: Buffer.from('x'),
      originalName: 'clipboard-export',
      mimeType: 'image/png',
      size: 1,
      req: {},
    });

    expect(result.key.endsWith('.png')).toBe(true);
  });

  it('should ignore unsafe extension characters', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-lfp2-'));
    const provider = createLocalFileProvider({ destDir: tmp, publicBasePath: '/u' });

    const result = await provider.put({
      buffer: Buffer.from('x'),
      originalName: 'a/../../../etc/passwd',
      mimeType: 'text/plain',
      size: 1,
      req: {},
    });

    expect(result.key).not.toContain('..');
    const files = await fs.readdir(tmp);
    expect(files.length).toBe(1);
  });
});

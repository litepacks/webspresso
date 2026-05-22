/**
 * Multipart upload extraction (parseBody / File-like bodies)
 */

const { extractUploadFile } = require('../../../src/http/multipart');

describe('http/multipart extractUploadFile', () => {
  it('returns null when field is missing', async () => {
    expect(await extractUploadFile({ body: {} }, 'file', 1024)).toBeNull();
    expect(await extractUploadFile({ body: null }, 'file', 1024)).toBeNull();
  });

  it('extracts File-like object via arrayBuffer', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const file = {
      arrayBuffer: async () => bytes.buffer,
      type: 'image/png',
      name: 'photo.png',
    };
    const out = await extractUploadFile({ body: { file } }, 'file', 1024);
    expect(out).toMatchObject({
      mimetype: 'image/png',
      originalname: 'photo.png',
      size: 4,
    });
    expect(Buffer.isBuffer(out.buffer)).toBe(true);
  });

  it('uses mimetype fallback when type is missing', async () => {
    const file = {
      arrayBuffer: async () => new Uint8Array([1]).buffer,
      mimetype: 'text/plain',
      originalname: 'a.txt',
    };
    const out = await extractUploadFile({ body: { file } }, 'file', 1024);
    expect(out.mimetype).toBe('text/plain');
  });

  it('throws LIMIT_FILE_SIZE for File-like when over maxBytes', async () => {
    const file = {
      arrayBuffer: async () => new Uint8Array(20).buffer,
      type: 'application/octet-stream',
      name: 'big.bin',
    };
    await expect(extractUploadFile({ body: { file } }, 'file', 10)).rejects.toMatchObject({
      message: 'File too large',
      code: 'LIMIT_FILE_SIZE',
    });
  });

  it('extracts raw Buffer on body field', async () => {
    const buf = Buffer.from('hello');
    const out = await extractUploadFile({ body: { file: buf } }, 'file', 1024);
    expect(out).toEqual({
      buffer: buf,
      mimetype: 'application/octet-stream',
      originalname: 'upload',
      size: 5,
    });
  });

  it('throws LIMIT_FILE_SIZE for Buffer over maxBytes', async () => {
    const buf = Buffer.alloc(50);
    await expect(extractUploadFile({ body: { file: buf } }, 'file', 10)).rejects.toMatchObject({
      code: 'LIMIT_FILE_SIZE',
    });
  });

  it('returns null for unsupported body shape', async () => {
    expect(await extractUploadFile({ body: { file: 'not-a-file' } }, 'file', 1024)).toBeNull();
    expect(await extractUploadFile({ body: { file: 42 } }, 'file', 1024)).toBeNull();
  });
});

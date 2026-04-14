/**
 * reCAPTCHA verify unit tests
 */
const { verifyRecaptcha, getRemoteIp } = require('../../../plugins/recaptcha/verify');

describe('verifyRecaptcha', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws without secret', async () => {
    await expect(verifyRecaptcha({ token: 'x' })).rejects.toThrow(/secret/);
  });

  it('returns failure when token missing', async () => {
    const r = await verifyRecaptcha({ secret: 's', token: '' });
    expect(r.success).toBe(false);
    expect(r.errorCodes).toContain('missing-input-response');
  });

  it('returns success for v2 when Google returns success true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, hostname: 'example.com' }),
      })
    );

    const r = await verifyRecaptcha({
      secret: 'sec',
      token: 'tok',
      version: 'v2',
    });
    expect(r.success).toBe(true);
    expect(r.hostname).toBe('example.com');
    expect(fetch).toHaveBeenCalledWith(
      'https://www.google.com/recaptcha/api/siteverify',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('returns failure when Google returns success false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: false,
            'error-codes': ['invalid-input-response'],
          }),
      })
    );

    const r = await verifyRecaptcha({ secret: 'sec', token: 'bad', version: 'v2' });
    expect(r.success).toBe(false);
    expect(r.errorCodes).toContain('invalid-input-response');
  });

  it('v3 fails when score below minScore', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            score: 0.1,
            action: 'submit',
          }),
      })
    );

    const r = await verifyRecaptcha({
      secret: 'sec',
      token: 'tok',
      version: 'v3',
      minScore: 0.5,
    });
    expect(r.success).toBe(false);
    expect(r.score).toBe(0.1);
    expect(r.errorCodes).toContain('score-too-low');
  });

  it('v3 succeeds when score and action match', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            score: 0.9,
            action: 'contact',
          }),
      })
    );

    const r = await verifyRecaptcha({
      secret: 'sec',
      token: 'tok',
      version: 'v3',
      expectedAction: 'contact',
      minScore: 0.5,
    });
    expect(r.success).toBe(true);
    expect(r.score).toBe(0.9);
  });

  it('v3 fails when expectedAction mismatches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            score: 0.9,
            action: 'other',
          }),
      })
    );

    const r = await verifyRecaptcha({
      secret: 'sec',
      token: 'tok',
      version: 'v3',
      expectedAction: 'contact',
    });
    expect(r.success).toBe(false);
    expect(r.errorCodes).toContain('action-mismatch');
  });

  it('sends remoteip when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await verifyRecaptcha({
      secret: 'sec',
      token: 't',
      remoteIp: '203.0.113.1',
      version: 'v2',
    });

    const call = fetchMock.mock.calls[0];
    const body = call[1].body;
    expect(String(body)).toContain('remoteip');
    expect(String(body)).toContain('203.0.113.1');
  });
});

describe('getRemoteIp', () => {
  it('reads x-forwarded-for first value', () => {
    const req = {
      headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' },
      ip: '127.0.0.1',
    };
    expect(getRemoteIp(req)).toBe('1.1.1.1');
  });

  it('falls back to req.ip', () => {
    const req = { headers: {}, ip: '::1' };
    expect(getRemoteIp(req)).toBe('::1');
  });
});

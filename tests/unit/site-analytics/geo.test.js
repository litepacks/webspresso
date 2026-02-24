/**
 * Country Detection Unit Tests
 */
const { detectCountry } = require('../../../plugins/site-analytics/geo');

describe('Country Detection', () => {
  function mockReq(headers) {
    return { headers: headers || {} };
  }

  describe('CDN headers', () => {
    it('should detect country from CF-IPCountry header', () => {
      expect(detectCountry(mockReq({ 'cf-ipcountry': 'DE' }))).toBe('DE');
    });

    it('should ignore CF-IPCountry XX (unknown)', () => {
      expect(detectCountry(mockReq({ 'cf-ipcountry': 'XX' }))).toBeNull();
    });

    it('should ignore CF-IPCountry T1 (Tor)', () => {
      expect(detectCountry(mockReq({ 'cf-ipcountry': 'T1' }))).toBeNull();
    });

    it('should detect from x-vercel-ip-country header', () => {
      expect(detectCountry(mockReq({ 'x-vercel-ip-country': 'JP' }))).toBe('JP');
    });

    it('should detect from x-country-code header', () => {
      expect(detectCountry(mockReq({ 'x-country-code': 'br' }))).toBe('BR');
    });

    it('should prioritize CDN headers over Accept-Language', () => {
      const req = mockReq({
        'cf-ipcountry': 'FR',
        'accept-language': 'de-DE,de;q=0.9',
      });
      expect(detectCountry(req)).toBe('FR');
    });
  });

  describe('Accept-Language fallback', () => {
    it('should detect Turkish', () => {
      expect(detectCountry(mockReq({ 'accept-language': 'tr-TR,tr;q=0.9,en;q=0.8' }))).toBe('TR');
    });

    it('should detect German', () => {
      expect(detectCountry(mockReq({ 'accept-language': 'de-DE,de;q=0.9' }))).toBe('DE');
    });

    it('should detect Brazilian Portuguese', () => {
      expect(detectCountry(mockReq({ 'accept-language': 'pt-BR,pt;q=0.9' }))).toBe('BR');
    });

    it('should detect Japanese', () => {
      expect(detectCountry(mockReq({ 'accept-language': 'ja,en-US;q=0.7' }))).toBe('JP');
    });

    it('should detect English (US)', () => {
      expect(detectCountry(mockReq({ 'accept-language': 'en-US,en;q=0.9' }))).toBe('US');
    });

    it('should detect English (GB)', () => {
      expect(detectCountry(mockReq({ 'accept-language': 'en-GB,en;q=0.9' }))).toBe('GB');
    });

    it('should fall back to base language code', () => {
      expect(detectCountry(mockReq({ 'accept-language': 'ko;q=0.9' }))).toBe('KR');
    });
  });

  describe('edge cases', () => {
    it('should return null for no headers', () => {
      expect(detectCountry(mockReq({}))).toBeNull();
    });

    it('should return null for empty accept-language', () => {
      expect(detectCountry(mockReq({ 'accept-language': '' }))).toBeNull();
    });

    it('should return null for unrecognized language', () => {
      expect(detectCountry(mockReq({ 'accept-language': 'xx-XX' }))).toBeNull();
    });
  });
});

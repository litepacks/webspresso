/**
 * Bot Patterns Unit Tests
 */
const { detectBot } = require('../../../plugins/site-analytics/bot-patterns');

describe('Bot Detection', () => {
  describe('detectBot', () => {
    it('should detect Googlebot', () => {
      const result = detectBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
      expect(result.isBot).toBe(true);
      expect(result.botName).toBe('Google');
    });

    it('should detect Bingbot', () => {
      const result = detectBot('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)');
      expect(result.isBot).toBe(true);
      expect(result.botName).toBe('Bing');
    });

    it('should detect curl', () => {
      const result = detectBot('curl/7.81.0');
      expect(result.isBot).toBe(true);
      expect(result.botName).toBe('curl');
    });

    it('should detect Python requests', () => {
      const result = detectBot('python-requests/2.28.0');
      expect(result.isBot).toBe(true);
      expect(result.botName).toBe('Python');
    });

    it('should detect wget', () => {
      const result = detectBot('Wget/1.21.3');
      expect(result.isBot).toBe(true);
      expect(result.botName).toBe('wget');
    });

    it('should detect Facebook bot', () => {
      const result = detectBot('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)');
      expect(result.isBot).toBe(true);
      expect(result.botName).toBe('facebook');
    });

    it('should detect WhatsApp', () => {
      const result = detectBot('WhatsApp/2.23.20.0');
      expect(result.isBot).toBe(true);
      expect(result.botName).toBe('WhatsApp');
    });

    it('should detect GPTBot', () => {
      const result = detectBot('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0)');
      expect(result.isBot).toBe(true);
      expect(result.botName).toBe('GPTBot');
    });

    it('should detect open-research-bot', () => {
      const result = detectBot('Mozilla/5.0 (compatible; open-research-bot)');
      expect(result.isBot).toBe(true);
      expect(result.botName).toBe('open-research-bot');
    });

    it('should detect generic spider/crawler', () => {
      const result = detectBot('SomeSpider/1.0');
      expect(result.isBot).toBe(true);
      expect(result.botName).toBe('spider');
    });

    it('should NOT detect regular Chrome browser', () => {
      const result = detectBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      expect(result.isBot).toBe(false);
      expect(result.botName).toBeNull();
    });

    it('should NOT detect regular Firefox browser', () => {
      const result = detectBot('Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0');
      expect(result.isBot).toBe(false);
      expect(result.botName).toBeNull();
    });

    it('should NOT detect Safari on iPhone', () => {
      const result = detectBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15');
      expect(result.isBot).toBe(false);
      expect(result.botName).toBeNull();
    });

    it('should handle null/empty user agent', () => {
      expect(detectBot(null).isBot).toBe(false);
      expect(detectBot('').isBot).toBe(false);
      expect(detectBot(undefined).isBot).toBe(false);
    });

    it('should detect headless browsers', () => {
      const result = detectBot('Mozilla/5.0 HeadlessChrome/120.0');
      expect(result.isBot).toBe(true);
      expect(result.botName).toBe('headless');
    });

    it('should detect node-fetch / axios', () => {
      const r1 = detectBot('node-fetch/1.0');
      expect(r1.isBot).toBe(true);
      expect(r1.botName).toBe('http');

      const r2 = detectBot('axios/1.6.0');
      expect(r2.isBot).toBe(true);
      expect(r2.botName).toBe('http');
    });
  });
});

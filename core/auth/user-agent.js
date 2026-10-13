/**
 * Webspresso Zero-Dependency User-Agent & Device Parser
 * Extracts browser, operating system, and device category from User-Agent header
 * @module core/auth/user-agent
 */

'use strict';

/**
 * @typedef {Object} DeviceInfo
 * @property {string} browser - Browser name with major version (e.g. 'Chrome 128', 'Safari 17')
 * @property {string} os - Operating system name (e.g. 'macOS 14', 'Windows 11', 'iOS 17')
 * @property {'desktop'|'mobile'|'tablet'|'bot'|'unknown'} device - Device category
 * @property {boolean} isMobile
 * @property {boolean} isTablet
 * @property {boolean} isDesktop
 * @property {boolean} isBot
 */

/**
 * Extract client IP address handling proxies
 * @param {Object} req - Express / Node.js HTTP request
 * @returns {string}
 */
function getClientIp(req) {
  if (!req) return '127.0.0.1';

  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    const ips = typeof forwarded === 'string' ? forwarded.split(',') : forwarded;
    const first = Array.isArray(ips) ? ips[0] : ips;
    if (first) return first.trim();
  }

  return req.headers?.['x-real-ip'] ||
    req.ip ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    '127.0.0.1';
}

/**
 * Parse raw User-Agent header string into structured device info
 * Zero external dependencies — pure regex extraction
 * 
 * @param {string} [userAgent='']
 * @returns {DeviceInfo}
 */
function parseUserAgent(userAgent = '') {
  const ua = String(userAgent || '').trim();

  if (!ua) {
    return {
      browser: 'Unknown',
      os: 'Unknown',
      device: 'unknown',
      isMobile: false,
      isTablet: false,
      isDesktop: false,
      isBot: false,
    };
  }

  // 1. Detect Bots / Crawlers
  const botPattern = /googlebot|bingbot|yandex|baiduspider|duckduckbot|slurp|twitterbot|facebookexternalhit|rogerbot|linkedinbot|embedly|quora link preview|showyoubot|outbrain|pinterest\/|slackbot|vkshare|w3c_validator|whatsapp|curl|wget|postman/i;
  const isBot = botPattern.test(ua);

  // 2. Detect Operating System
  let os = 'Unknown';
  if (/iPad/i.test(ua)) {
    const match = ua.match(/OS ([\d_\.]+)/i);
    os = match ? `iPadOS ${match[1].replace(/_/g, '.')}` : 'iPadOS';
  } else if (/iPhone|iPod/i.test(ua)) {
    const match = ua.match(/OS ([\d_\.]+)/i);
    os = match ? `iOS ${match[1].replace(/_/g, '.')}` : 'iOS';
  } else if (/Android/i.test(ua)) {
    const match = ua.match(/Android (\d+(\.\d+)?)/i);
    os = match ? `Android ${match[1]}` : 'Android';
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    const match = ua.match(/Mac OS X ([\d_\.]+)/i);
    if (match) {
      const ver = match[1].replace(/_/g, '.');
      os = `macOS ${ver}`;
    } else {
      os = 'macOS';
    }
  } else if (/Windows/i.test(ua)) {
    if (/Windows NT 10\.0/i.test(ua)) os = 'Windows 10/11';
    else if (/Windows NT 6\.3/i.test(ua)) os = 'Windows 8.1';
    else if (/Windows NT 6\.2/i.test(ua)) os = 'Windows 8';
    else if (/Windows NT 6\.1/i.test(ua)) os = 'Windows 7';
    else os = 'Windows';
  } else if (/CrOS/i.test(ua)) {
    os = 'ChromeOS';
  } else if (/Linux/i.test(ua)) {
    if (/Ubuntu/i.test(ua)) os = 'Ubuntu Linux';
    else if (/Fedora/i.test(ua)) os = 'Fedora Linux';
    else os = 'Linux';
  }

  // 3. Detect Browser
  let browser = 'Unknown';
  if (/Edg(e|A|iOS)?\/(\d+)/i.test(ua)) {
    const match = ua.match(/Edg(e|A|iOS)?\/(\d+)/i);
    browser = `Edge ${match ? match[2] : ''}`.trim();
  } else if (/OPR\/(\d+)/i.test(ua)) {
    const match = ua.match(/OPR\/(\d+)/i);
    browser = `Opera ${match ? match[1] : ''}`.trim();
  } else if (/SamsungBrowser\/(\d+)/i.test(ua)) {
    const match = ua.match(/SamsungBrowser\/(\d+)/i);
    browser = `Samsung Internet ${match ? match[1] : ''}`.trim();
  } else if (/Brave\/(\d+)/i.test(ua)) {
    const match = ua.match(/Brave\/(\d+)/i);
    browser = `Brave ${match ? match[1] : ''}`.trim();
  } else if (/Vivaldi\/(\d+)/i.test(ua)) {
    const match = ua.match(/Vivaldi\/(\d+)/i);
    browser = `Vivaldi ${match ? match[1] : ''}`.trim();
  } else if (/Chrome\/(\d+)/i.test(ua) && !/Chromium/i.test(ua)) {
    const match = ua.match(/Chrome\/(\d+)/i);
    browser = `Chrome ${match ? match[1] : ''}`.trim();
  } else if (/Firefox\/(\d+)/i.test(ua) || /FxiOS\/(\d+)/i.test(ua)) {
    const match = ua.match(/(?:Firefox|FxiOS)\/(\d+)/i);
    browser = `Firefox ${match ? match[1] : ''}`.trim();
  } else if (/Version\/(\d+).*Safari/i.test(ua)) {
    const match = ua.match(/Version\/(\d+)/i);
    browser = `Safari ${match ? match[1] : ''}`.trim();
  } else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) {
    browser = 'Safari';
  } else if (/MSIE (\d+)|Trident.*rv:(\d+)/i.test(ua)) {
    browser = 'Internet Explorer';
  } else if (isBot) {
    const botNameMatch = ua.match(/(googlebot|bingbot|duckduckbot|slurp|twitterbot|slackbot|curl|wget)/i);
    browser = botNameMatch ? botNameMatch[1] : 'Bot';
  }

  // 4. Detect Device Category
  const isTablet = /iPad|tablet|(android(?!.*mobile))/i.test(ua);
  const isMobile = !isTablet && /mobile|iphone|ipod|android|blackberry|opera mini|windows phone/i.test(ua);
  const isDesktop = !isTablet && !isMobile && !isBot;

  let device = 'unknown';
  if (isBot) device = 'bot';
  else if (isTablet) device = 'tablet';
  else if (isMobile) device = 'mobile';
  else if (isDesktop) device = 'desktop';

  return {
    browser,
    os,
    device,
    isMobile,
    isTablet,
    isDesktop,
    isBot,
  };
}

module.exports = {
  getClientIp,
  parseUserAgent,
};

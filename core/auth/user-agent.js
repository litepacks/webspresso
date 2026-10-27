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

const { getClientIp } = require('../utils/ip');

/**
 * Parse raw User-Agent header string into structured device info
 * Zero external dependencies — pure regex extraction
 * 
 * @param {string} [userAgent='']
 * @returns {DeviceInfo}
 */
const MAX_UA_CACHE = 512;
const uaCache = new Map();

const EMPTY_DEVICE_INFO = Object.freeze({
  browser: 'Unknown',
  os: 'Unknown',
  device: 'unknown',
  isMobile: false,
  isTablet: false,
  isDesktop: false,
  isBot: false,
});

const BOT_PATTERN = /googlebot|bingbot|yandex|baiduspider|duckduckbot|slurp|twitterbot|facebookexternalhit|rogerbot|linkedinbot|embedly|quora link preview|showyoubot|outbrain|pinterest\/|slackbot|vkshare|w3c_validator|whatsapp|curl|wget|postman/i;

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
    return { ...EMPTY_DEVICE_INFO };
  }

  const cached = uaCache.get(ua);
  if (cached) {
    uaCache.delete(ua);
    uaCache.set(ua, cached);
    return { ...cached };
  }

  // 1. Detect Bots / Crawlers
  const isBot = BOT_PATTERN.test(ua);

  // 2. Detect Operating System
  let os = 'Unknown';
  let match;
  if (/iPad/i.test(ua)) {
    match = ua.match(/OS ([\d_\.]+)/i);
    os = match ? `iPadOS ${match[1].replace(/_/g, '.')}` : 'iPadOS';
  } else if (/iPhone|iPod/i.test(ua)) {
    match = ua.match(/OS ([\d_\.]+)/i);
    os = match ? `iOS ${match[1].replace(/_/g, '.')}` : 'iOS';
  } else if ((match = ua.match(/Android (\d+(\.\d+)?)/i))) {
    os = `Android ${match[1]}`;
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    match = ua.match(/Mac OS X ([\d_\.]+)/i);
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
  if ((match = ua.match(/Edg(e|A|iOS)?\/(\d+)/i))) {
    browser = `Edge ${match[2] || ''}`.trim();
  } else if ((match = ua.match(/OPR\/(\d+)/i))) {
    browser = `Opera ${match[1] || ''}`.trim();
  } else if ((match = ua.match(/SamsungBrowser\/(\d+)/i))) {
    browser = `Samsung Internet ${match[1] || ''}`.trim();
  } else if ((match = ua.match(/Brave\/(\d+)/i))) {
    browser = `Brave ${match[1] || ''}`.trim();
  } else if ((match = ua.match(/Vivaldi\/(\d+)/i))) {
    browser = `Vivaldi ${match[1] || ''}`.trim();
  } else if (!/Chromium/i.test(ua) && (match = ua.match(/Chrome\/(\d+)/i))) {
    browser = `Chrome ${match[1] || ''}`.trim();
  } else if ((match = ua.match(/(?:Firefox|FxiOS)\/(\d+)/i))) {
    browser = `Firefox ${match[1] || ''}`.trim();
  } else if ((match = ua.match(/Version\/(\d+)/i)) && /Safari/i.test(ua)) {
    browser = `Safari ${match[1] || ''}`.trim();
  } else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) {
    browser = 'Safari';
  } else if (/MSIE (\d+)/i.test(ua) || (/Trident/i.test(ua) && /rv:(\d+)/i.test(ua))) {
    browser = 'Internet Explorer';
  } else if (isBot) {
    const botNameMatch = ua.match(/(googlebot|bingbot|duckduckbot|slurp|twitterbot|slackbot|curl|wget)/i);
    browser = botNameMatch ? botNameMatch[1] : 'Bot';
  }

  // 4. Detect Device Category
  const isTablet = /iPad|tablet/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua));
  const isMobile = !isTablet && /mobile|iphone|ipod|android|blackberry|opera mini|windows phone/i.test(ua);
  const isDesktop = !isTablet && !isMobile && !isBot;

  let device = 'unknown';
  if (isBot) device = 'bot';
  else if (isTablet) device = 'tablet';
  else if (isMobile) device = 'mobile';
  else if (isDesktop) device = 'desktop';

  const result = {
    browser,
    os,
    device,
    isMobile,
    isTablet,
    isDesktop,
    isBot,
  };

  if (uaCache.size >= MAX_UA_CACHE) {
    const oldestKey = uaCache.keys().next().value;
    uaCache.delete(oldestKey);
  }
  uaCache.set(ua, result);

  return { ...result };
}

module.exports = {
  getClientIp,
  parseUserAgent,
};


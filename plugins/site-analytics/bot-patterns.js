/**
 * Bot Detection Patterns
 * User-agent based bot identification
 * @module plugins/site-analytics/bot-patterns
 */

const BOT_PATTERNS = [
  { pattern: /googlebot/i, name: 'Google' },
  { pattern: /bingbot/i, name: 'Bing' },
  { pattern: /slurp/i, name: 'Yahoo' },
  { pattern: /duckduckbot/i, name: 'DuckDuckGo' },
  { pattern: /baiduspider/i, name: 'Baidu' },
  { pattern: /yandexbot/i, name: 'Yandex' },
  { pattern: /facebookexternalhit|facebot/i, name: 'facebook' },
  { pattern: /twitterbot/i, name: 'Twitter' },
  { pattern: /linkedinbot/i, name: 'LinkedIn' },
  { pattern: /whatsapp/i, name: 'WhatsApp' },
  { pattern: /telegrambot/i, name: 'Telegram' },
  { pattern: /discordbot/i, name: 'Discord' },
  { pattern: /slackbot/i, name: 'Slack' },
  { pattern: /pinterest/i, name: 'Pinterest' },
  { pattern: /applebot/i, name: 'Apple' },
  { pattern: /semrushbot/i, name: 'SEMrush' },
  { pattern: /ahrefsbot/i, name: 'Ahrefs' },
  { pattern: /mj12bot/i, name: 'Majestic' },
  { pattern: /dotbot/i, name: 'DotBot' },
  { pattern: /petalbot/i, name: 'PetalBot' },
  { pattern: /gptbot/i, name: 'GPTBot' },
  { pattern: /claudebot/i, name: 'ClaudeBot' },
  { pattern: /anthropic/i, name: 'Anthropic' },
  { pattern: /ccbot/i, name: 'CCBot' },
  { pattern: /bytespider/i, name: 'ByteSpider' },
  { pattern: /open-research-bot/i, name: 'open-research-bot' },
  { pattern: /ptb12/i, name: 'PTB12' },
  { pattern: /curl\//i, name: 'curl' },
  { pattern: /wget\//i, name: 'wget' },
  { pattern: /python-requests|python-urllib|aiohttp/i, name: 'Python' },
  { pattern: /axios|node-fetch|got\//i, name: 'http' },
  { pattern: /go-http-client/i, name: 'Go' },
  { pattern: /java\//i, name: 'Java' },
  { pattern: /ruby/i, name: 'Ruby' },
  { pattern: /perl/i, name: 'Perl' },
  { pattern: /php\//i, name: 'PHP' },
  { pattern: /scrapy/i, name: 'Scrapy' },
  { pattern: /headlesschrome|phantomjs|puppeteer/i, name: 'headless' },
  { pattern: /spider|crawler|crawl|scraper|fetch|scan/i, name: 'spider' },
  { pattern: /bot[\/\s;)]/i, name: 'bot' },
  { pattern: /export/i, name: 'export' },
];

/**
 * Detect if a user-agent belongs to a bot
 * @param {string} userAgent
 * @returns {{ isBot: boolean, botName: string|null }}
 */
function detectBot(userAgent) {
  if (!userAgent) return { isBot: false, botName: null };

  for (const { pattern, name } of BOT_PATTERNS) {
    if (pattern.test(userAgent)) {
      return { isBot: true, botName: name };
    }
  }

  return { isBot: false, botName: null };
}

module.exports = { detectBot, BOT_PATTERNS };

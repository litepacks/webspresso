/**
 * Country Detection
 * Lightweight country detection from request headers
 * @module plugins/site-analytics/geo
 */

const LANGUAGE_TO_COUNTRY = {
  en: 'US', 'en-us': 'US', 'en-gb': 'GB', 'en-au': 'AU', 'en-ca': 'CA',
  'en-nz': 'NZ', 'en-ie': 'IE', 'en-za': 'ZA', 'en-in': 'IN',
  de: 'DE', 'de-de': 'DE', 'de-at': 'AT', 'de-ch': 'CH',
  fr: 'FR', 'fr-fr': 'FR', 'fr-ca': 'CA', 'fr-be': 'BE', 'fr-ch': 'CH',
  es: 'ES', 'es-es': 'ES', 'es-mx': 'MX', 'es-ar': 'AR', 'es-co': 'CO',
  pt: 'PT', 'pt-br': 'BR', 'pt-pt': 'PT',
  it: 'IT', nl: 'NL', pl: 'PL', sv: 'SE', da: 'DK', nb: 'NO', nn: 'NO',
  fi: 'FI', el: 'GR', cs: 'CZ', sk: 'SK', hu: 'HU', ro: 'RO',
  bg: 'BG', hr: 'HR', sl: 'SI', sr: 'RS', uk: 'UA', be: 'BY',
  ru: 'RU', tr: 'TR', ar: 'SA', he: 'IL', fa: 'IR',
  hi: 'IN', bn: 'BD', ta: 'IN', te: 'IN', mr: 'IN', gu: 'IN',
  ja: 'JP', ko: 'KR', zh: 'CN', 'zh-cn': 'CN', 'zh-tw': 'TW', 'zh-hk': 'HK',
  th: 'TH', vi: 'VN', id: 'ID', ms: 'MY', tl: 'PH',
};

/**
 * Detect country from request headers
 * Priority: CDN headers > Accept-Language
 * @param {Object} req - Express request
 * @returns {string|null} ISO 3166-1 alpha-2 country code
 */
function detectCountry(req) {
  // Cloudflare
  const cfCountry = req.headers['cf-ipcountry'];
  if (cfCountry && cfCountry !== 'XX' && cfCountry !== 'T1') {
    return cfCountry.toUpperCase();
  }

  // Vercel / various CDNs
  const xCountry = req.headers['x-vercel-ip-country']
    || req.headers['x-country-code']
    || req.headers['x-country'];
  if (xCountry) {
    return xCountry.toUpperCase();
  }

  // Fallback: Accept-Language header
  const acceptLang = req.headers['accept-language'];
  if (!acceptLang) return null;

  const parts = acceptLang.split(',');
  for (const part of parts) {
    const lang = part.split(';')[0].trim().toLowerCase();
    if (LANGUAGE_TO_COUNTRY[lang]) {
      return LANGUAGE_TO_COUNTRY[lang];
    }
    const base = lang.split('-')[0];
    if (LANGUAGE_TO_COUNTRY[base]) {
      return LANGUAGE_TO_COUNTRY[base];
    }
  }

  return null;
}

module.exports = { detectCountry };

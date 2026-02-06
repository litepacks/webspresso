/**
 * Client-side SEO Analyzer Script
 * This is injected into the page and runs all SEO checks
 */

const analyzerScript = `
(function() {
  'use strict';

  const settings = window.__SEO_CHECKER_SETTINGS__ || {};
  const checkDefs = window.__SEO_CHECKER_CHECKS__ || [];

  /**
   * SEO Check implementations
   */
  const checks = {
    // ==================== META CHECKS ====================
    titleExists() {
      const title = document.querySelector('title');
      const text = title ? title.textContent.trim() : '';
      return {
        pass: text.length > 0,
        value: text || '(no title)',
        message: text ? 'Page has a title' : 'Page is missing a title tag'
      };
    },

    titleLength() {
      const title = document.querySelector('title');
      const text = title ? title.textContent.trim() : '';
      const [min, max] = settings.titleLength || [30, 60];
      const len = text.length;
      
      if (len === 0) {
        return { pass: false, value: '0 chars', message: 'No title found' };
      }
      if (len < min) {
        return { pass: false, value: len + ' chars', message: 'Title is too short (min ' + min + ')' };
      }
      if (len > max) {
        return { pass: 'warning', value: len + ' chars', message: 'Title is too long (max ' + max + ')' };
      }
      return { pass: true, value: len + ' chars', message: 'Title length is optimal' };
    },

    descriptionExists() {
      const meta = document.querySelector('meta[name="description"]');
      const content = meta ? meta.getAttribute('content') || '' : '';
      return {
        pass: content.length > 0,
        value: content ? content.substring(0, 50) + (content.length > 50 ? '...' : '') : '(no description)',
        message: content ? 'Page has a meta description' : 'Page is missing meta description'
      };
    },

    descriptionLength() {
      const meta = document.querySelector('meta[name="description"]');
      const content = meta ? meta.getAttribute('content') || '' : '';
      const [min, max] = settings.descriptionLength || [50, 160];
      const len = content.length;
      
      if (len === 0) {
        return { pass: false, value: '0 chars', message: 'No description found' };
      }
      if (len < min) {
        return { pass: 'warning', value: len + ' chars', message: 'Description is too short (min ' + min + ')' };
      }
      if (len > max) {
        return { pass: 'warning', value: len + ' chars', message: 'Description is too long (max ' + max + ')' };
      }
      return { pass: true, value: len + ' chars', message: 'Description length is optimal' };
    },

    canonicalExists() {
      const link = document.querySelector('link[rel="canonical"]');
      const href = link ? link.getAttribute('href') : '';
      return {
        pass: !!href,
        value: href || '(not set)',
        message: href ? 'Canonical URL is set' : 'No canonical URL found'
      };
    },

    viewportExists() {
      const meta = document.querySelector('meta[name="viewport"]');
      const content = meta ? meta.getAttribute('content') : '';
      return {
        pass: !!content,
        value: content ? 'Set' : 'Missing',
        message: content ? 'Viewport meta is configured' : 'Viewport meta tag is missing'
      };
    },

    robotsMeta() {
      const meta = document.querySelector('meta[name="robots"]');
      const content = meta ? meta.getAttribute('content') || '' : '';
      const isNoindex = content.toLowerCase().includes('noindex');
      const isNofollow = content.toLowerCase().includes('nofollow');
      
      if (!meta) {
        return { pass: true, value: 'Default (index, follow)', message: 'Using default robot rules' };
      }
      if (isNoindex) {
        return { pass: 'warning', value: content, message: 'Page is set to noindex' };
      }
      return { pass: true, value: content, message: 'Robots meta is configured' };
    },

    charsetExists() {
      const meta = document.querySelector('meta[charset]') || 
                   document.querySelector('meta[http-equiv="Content-Type"]');
      const charset = meta ? (meta.getAttribute('charset') || meta.getAttribute('content') || '') : '';
      const isUtf8 = charset.toLowerCase().includes('utf-8');
      return {
        pass: isUtf8,
        value: charset || 'Not set',
        message: isUtf8 ? 'UTF-8 charset is declared' : 'UTF-8 charset should be declared'
      };
    },

    langExists() {
      const html = document.documentElement;
      const lang = html.getAttribute('lang');
      return {
        pass: !!lang,
        value: lang || 'Not set',
        message: lang ? 'Language is declared: ' + lang : 'HTML lang attribute is missing'
      };
    },

    // ==================== HEADING CHECKS ====================
    h1Exists() {
      const h1s = document.querySelectorAll('h1');
      return {
        pass: h1s.length > 0,
        value: h1s.length + ' found',
        message: h1s.length > 0 ? 'Page has H1 tag(s)' : 'Page is missing an H1 tag'
      };
    },

    h1Single() {
      const h1s = document.querySelectorAll('h1');
      if (h1s.length === 0) {
        return { pass: false, value: '0 H1 tags', message: 'No H1 tag found' };
      }
      if (h1s.length > 1) {
        return { pass: 'warning', value: h1s.length + ' H1 tags', message: 'Multiple H1 tags found (should be 1)' };
      }
      return { pass: true, value: '1 H1 tag', message: 'Single H1 tag found' };
    },

    h1First() {
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      if (headings.length === 0) {
        return { pass: 'warning', value: 'No headings', message: 'No headings found on page' };
      }
      const first = headings[0];
      const isH1 = first.tagName === 'H1';
      return {
        pass: isH1,
        value: first.tagName,
        message: isH1 ? 'H1 is the first heading' : 'First heading is ' + first.tagName + ', should be H1'
      };
    },

    headingHierarchy() {
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      const levels = Array.from(headings).map(h => parseInt(h.tagName[1]));
      const issues = [];
      
      for (let i = 1; i < levels.length; i++) {
        const diff = levels[i] - levels[i-1];
        if (diff > 1) {
          issues.push('Skipped from H' + levels[i-1] + ' to H' + levels[i]);
        }
      }
      
      if (issues.length > 0) {
        return { 
          pass: 'warning', 
          value: issues.length + ' issue(s)', 
          message: issues.slice(0, 2).join('; ') + (issues.length > 2 ? '...' : '')
        };
      }
      return { pass: true, value: 'Valid', message: 'Heading hierarchy is correct' };
    },

    headingsNotEmpty() {
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      const empty = Array.from(headings).filter(h => !h.textContent.trim());
      
      if (empty.length > 0) {
        return { 
          pass: false, 
          value: empty.length + ' empty', 
          message: empty.length + ' empty heading(s) found'
        };
      }
      return { pass: true, value: 'All valid', message: 'All headings have content' };
    },

    // ==================== CONTENT CHECKS ====================
    wordCount() {
      // Get main content, excluding nav, header, footer, aside
      const excludeSelectors = 'nav, header, footer, aside, script, style, noscript, #webspresso-dev-toolbar, #seo-checker-panel';
      const body = document.body.cloneNode(true);
      body.querySelectorAll(excludeSelectors).forEach(el => el.remove());
      
      const text = body.textContent || '';
      const words = text.trim().split(/\\s+/).filter(w => w.length > 0);
      const count = words.length;
      const min = settings.minContentWords || 300;
      const max = settings.maxContentWords || 2500;
      
      if (count < min) {
        return { 
          pass: false, 
          value: count + ' words', 
          message: 'Content is thin (min ' + min + ' recommended)'
        };
      }
      if (count > max) {
        return { 
          pass: 'warning', 
          value: count + ' words', 
          message: 'Content might be too long for a single page'
        };
      }
      return { pass: true, value: count + ' words', message: 'Good content length' };
    },

    hasParagraphs() {
      const paragraphs = document.querySelectorAll('main p, article p, .content p, body > p');
      const withContent = Array.from(paragraphs).filter(p => p.textContent.trim().length > 50);
      
      if (withContent.length === 0) {
        return { pass: 'warning', value: '0 paragraphs', message: 'No substantial paragraphs found' };
      }
      return { pass: true, value: withContent.length + ' paragraphs', message: 'Content has paragraphs' };
    },

    keywordInContent() {
      const title = document.querySelector('title');
      const titleText = title ? title.textContent.trim().toLowerCase() : '';
      const keywords = titleText.split(/\\s+/).filter(w => w.length > 4);
      
      if (keywords.length === 0) {
        return { pass: 'warning', value: 'N/A', message: 'No keywords to check (title too short)' };
      }
      
      const body = document.body.textContent.toLowerCase();
      const found = keywords.filter(kw => body.includes(kw));
      const ratio = found.length / keywords.length;
      
      if (ratio < 0.5) {
        return { 
          pass: 'warning', 
          value: Math.round(ratio * 100) + '% match', 
          message: 'Title keywords are underused in content'
        };
      }
      return { pass: true, value: Math.round(ratio * 100) + '% match', message: 'Title keywords appear in content' };
    },

    keywordEarly() {
      const title = document.querySelector('title');
      const titleText = title ? title.textContent.trim().toLowerCase() : '';
      const keywords = titleText.split(/\\s+/).filter(w => w.length > 4);
      
      if (keywords.length === 0) {
        return { pass: 'warning', value: 'N/A', message: 'No keywords to check' };
      }
      
      const limit = settings.keywordsInFirstWords || 50;
      const excludeSelectors = 'nav, header, footer, aside, script, style';
      const body = document.body.cloneNode(true);
      body.querySelectorAll(excludeSelectors).forEach(el => el.remove());
      const text = (body.textContent || '').toLowerCase();
      const firstWords = text.trim().split(/\\s+/).slice(0, limit).join(' ');
      
      const found = keywords.filter(kw => firstWords.includes(kw));
      
      if (found.length === 0) {
        return { 
          pass: 'warning', 
          value: '0 found', 
          message: 'No keywords in first ' + limit + ' words'
        };
      }
      return { pass: true, value: found.length + ' found', message: 'Keywords appear early in content' };
    },

    // ==================== LINK CHECKS ====================
    internalLinks() {
      const links = document.querySelectorAll('a[href]');
      const host = window.location.host;
      const internal = Array.from(links).filter(a => {
        const href = a.getAttribute('href') || '';
        if (href.startsWith('#') || href.startsWith('javascript:')) return false;
        if (href.startsWith('/') && !href.startsWith('//')) return true;
        try {
          const url = new URL(href, window.location.origin);
          return url.host === host;
        } catch (e) {
          return false;
        }
      });
      
      const min = settings.minInternalLinks || 1;
      const count = internal.length;
      
      if (count < min) {
        return { 
          pass: 'warning', 
          value: count + ' links', 
          message: 'Add more internal links (min ' + min + ' recommended)'
        };
      }
      return { pass: true, value: count + ' links', message: 'Good internal linking' };
    },

    externalLinks() {
      const links = document.querySelectorAll('a[href]');
      const host = window.location.host;
      const external = Array.from(links).filter(a => {
        const href = a.getAttribute('href') || '';
        if (href.startsWith('#') || href.startsWith('/') || href.startsWith('javascript:')) return false;
        try {
          const url = new URL(href);
          return url.host !== host;
        } catch (e) {
          return false;
        }
      });
      
      const min = settings.minExternalLinks || 1;
      const count = external.length;
      
      return { 
        pass: count >= min, 
        value: count + ' links', 
        message: count >= min ? 'Has external links' : 'Consider adding external links'
      };
    },

    nofollowLinks() {
      const links = document.querySelectorAll('a[href]');
      const host = window.location.host;
      const external = Array.from(links).filter(a => {
        const href = a.getAttribute('href') || '';
        if (href.startsWith('#') || href.startsWith('/')) return false;
        try {
          const url = new URL(href);
          return url.host !== host;
        } catch (e) {
          return false;
        }
      });
      
      const nofollow = external.filter(a => {
        const rel = (a.getAttribute('rel') || '').toLowerCase();
        return rel.includes('nofollow');
      });
      
      return { 
        pass: true, 
        value: nofollow.length + '/' + external.length + ' nofollow', 
        message: 'External link nofollow status reviewed'
      };
    },

    anchorText() {
      const links = document.querySelectorAll('a[href]');
      const poor = Array.from(links).filter(a => {
        const text = a.textContent.trim().toLowerCase();
        const badTexts = ['click here', 'here', 'read more', 'more', 'link', 'this'];
        return badTexts.includes(text);
      });
      
      if (poor.length > 0) {
        return { 
          pass: 'warning', 
          value: poor.length + ' poor', 
          message: poor.length + ' link(s) have non-descriptive anchor text'
        };
      }
      return { pass: true, value: 'All descriptive', message: 'Link anchor texts are descriptive' };
    },

    emptyLinks() {
      const links = document.querySelectorAll('a[href]');
      const empty = Array.from(links).filter(a => {
        const href = a.getAttribute('href') || '';
        return !href || href === '#' || href === 'javascript:void(0)' || href === 'javascript:;';
      });
      
      if (empty.length > 0) {
        return { 
          pass: 'warning', 
          value: empty.length + ' empty', 
          message: empty.length + ' link(s) have no valid destination'
        };
      }
      return { pass: true, value: 'All valid', message: 'All links have valid hrefs' };
    },

    // ==================== IMAGE CHECKS ====================
    imageAlt() {
      const images = document.querySelectorAll('img');
      const noAlt = Array.from(images).filter(img => !img.hasAttribute('alt'));
      
      if (images.length === 0) {
        return { pass: true, value: 'No images', message: 'No images on page' };
      }
      if (noAlt.length > 0) {
        return { 
          pass: false, 
          value: noAlt.length + '/' + images.length + ' missing', 
          message: noAlt.length + ' image(s) missing alt attribute'
        };
      }
      return { pass: true, value: images.length + ' images', message: 'All images have alt attributes' };
    },

    imageAltDescriptive() {
      const images = document.querySelectorAll('img[alt]');
      const poor = Array.from(images).filter(img => {
        const alt = img.getAttribute('alt').trim().toLowerCase();
        const badAlts = ['image', 'img', 'photo', 'picture', 'untitled', ''];
        return badAlts.includes(alt) || alt.length < 3;
      });
      
      if (images.length === 0) {
        return { pass: true, value: 'N/A', message: 'No images with alt to check' };
      }
      if (poor.length > 0) {
        return { 
          pass: 'warning', 
          value: poor.length + ' poor', 
          message: poor.length + ' image(s) have non-descriptive alt text'
        };
      }
      return { pass: true, value: 'All descriptive', message: 'Image alt texts are descriptive' };
    },

    imageDimensions() {
      const images = document.querySelectorAll('img');
      const noDims = Array.from(images).filter(img => {
        return !img.hasAttribute('width') || !img.hasAttribute('height');
      });
      
      if (images.length === 0) {
        return { pass: true, value: 'No images', message: 'No images on page' };
      }
      if (noDims.length > 0) {
        return { 
          pass: 'warning', 
          value: noDims.length + '/' + images.length + ' missing', 
          message: noDims.length + ' image(s) missing dimensions (causes layout shift)'
        };
      }
      return { pass: true, value: 'All set', message: 'All images have dimensions' };
    },

    imageLazy() {
      const images = document.querySelectorAll('img');
      const lazy = Array.from(images).filter(img => img.hasAttribute('loading'));
      
      if (images.length === 0) {
        return { pass: true, value: 'No images', message: 'No images on page' };
      }
      return { 
        pass: true, 
        value: lazy.length + '/' + images.length + ' lazy', 
        message: lazy.length + ' image(s) use lazy loading'
      };
    },

    // ==================== STRUCTURED DATA CHECKS ====================
    ogTitle() {
      const meta = document.querySelector('meta[property="og:title"]');
      const content = meta ? meta.getAttribute('content') : '';
      return {
        pass: !!content,
        value: content ? content.substring(0, 30) + '...' : 'Not set',
        message: content ? 'Open Graph title is set' : 'Missing og:title'
      };
    },

    ogDescription() {
      const meta = document.querySelector('meta[property="og:description"]');
      const content = meta ? meta.getAttribute('content') : '';
      return {
        pass: !!content,
        value: content ? 'Set' : 'Not set',
        message: content ? 'Open Graph description is set' : 'Missing og:description'
      };
    },

    ogImage() {
      const meta = document.querySelector('meta[property="og:image"]');
      const content = meta ? meta.getAttribute('content') : '';
      return {
        pass: !!content,
        value: content ? 'Set' : 'Not set',
        message: content ? 'Open Graph image is set' : 'Missing og:image (important for social sharing)'
      };
    },

    ogUrl() {
      const meta = document.querySelector('meta[property="og:url"]');
      const content = meta ? meta.getAttribute('content') : '';
      return {
        pass: !!content,
        value: content ? 'Set' : 'Not set',
        message: content ? 'Open Graph URL is set' : 'Missing og:url'
      };
    },

    twitterCard() {
      const meta = document.querySelector('meta[name="twitter:card"]');
      const content = meta ? meta.getAttribute('content') : '';
      return {
        pass: !!content,
        value: content || 'Not set',
        message: content ? 'Twitter card is configured' : 'Missing twitter:card'
      };
    },

    jsonLd() {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      const count = scripts.length;
      
      if (count === 0) {
        return { pass: 'warning', value: 'Not found', message: 'No JSON-LD structured data found' };
      }
      
      // Validate JSON
      let valid = 0;
      scripts.forEach(s => {
        try {
          JSON.parse(s.textContent);
          valid++;
        } catch (e) {}
      });
      
      if (valid < count) {
        return { 
          pass: 'warning', 
          value: valid + '/' + count + ' valid', 
          message: (count - valid) + ' JSON-LD script(s) have invalid JSON'
        };
      }
      return { pass: true, value: count + ' schema(s)', message: 'JSON-LD structured data found' };
    },

    hreflang() {
      const links = document.querySelectorAll('link[hreflang]');
      const count = links.length;
      
      if (count === 0) {
        return { pass: true, value: 'Not used', message: 'No hreflang tags (OK for single-language sites)' };
      }
      
      // Check for x-default
      const hasDefault = Array.from(links).some(l => l.getAttribute('hreflang') === 'x-default');
      
      if (!hasDefault) {
        return { 
          pass: 'warning', 
          value: count + ' lang(s)', 
          message: 'Hreflang found but missing x-default'
        };
      }
      return { pass: true, value: count + ' lang(s)', message: 'Hreflang tags are configured' };
    },

    // ==================== URL CHECKS ====================
    urlLength() {
      const url = window.location.pathname;
      const max = settings.maxUrlLength || 75;
      const len = url.length;
      
      if (len > max) {
        return { 
          pass: 'warning', 
          value: len + ' chars', 
          message: 'URL is too long (max ' + max + ' recommended)'
        };
      }
      return { pass: true, value: len + ' chars', message: 'URL length is good' };
    },

    urlDepth() {
      const path = window.location.pathname;
      const segments = path.split('/').filter(s => s.length > 0);
      const depth = segments.length;
      const max = settings.maxUrlDepth || 3;
      
      if (depth > max) {
        return { 
          pass: 'warning', 
          value: depth + ' levels', 
          message: 'URL is too deep (max ' + max + ' recommended)'
        };
      }
      return { pass: true, value: depth + ' levels', message: 'URL depth is good' };
    },

    urlReadable() {
      const path = window.location.pathname;
      const hasUnderscores = path.includes('_');
      const hasNumbers = /\\d{5,}/.test(path);
      const hasWeirdChars = /[^a-zA-Z0-9\\-\\/\\.]/.test(path);
      
      const issues = [];
      if (hasUnderscores) issues.push('underscores (use hyphens)');
      if (hasNumbers) issues.push('long numbers');
      if (hasWeirdChars) issues.push('special characters');
      
      if (issues.length > 0) {
        return { 
          pass: 'warning', 
          value: issues.length + ' issue(s)', 
          message: 'URL contains: ' + issues.join(', ')
        };
      }
      return { pass: true, value: 'Clean URL', message: 'URL is readable and SEO-friendly' };
    },

    urlHttps() {
      const isHttps = window.location.protocol === 'https:';
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      
      if (isLocalhost) {
        return { pass: true, value: 'localhost', message: 'HTTPS not required for localhost' };
      }
      return {
        pass: isHttps,
        value: isHttps ? 'Secure' : 'Not secure',
        message: isHttps ? 'Page is served over HTTPS' : 'Page should use HTTPS'
      };
    }
  };

  /**
   * Run all SEO checks
   */
  function runAllChecks() {
    const results = [];
    const categoryScores = {};
    
    checkDefs.forEach(def => {
      const checkFn = checks[def.check];
      if (!checkFn) {
        console.warn('[SEO Checker] Unknown check:', def.check);
        return;
      }
      
      try {
        const result = checkFn();
        results.push({
          ...def,
          result
        });
        
        // Calculate category scores
        if (!categoryScores[def.category]) {
          categoryScores[def.category] = { total: 0, passed: 0, weight: 0 };
        }
        categoryScores[def.category].weight += def.weight;
        if (result.pass === true) {
          categoryScores[def.category].passed += def.weight;
        } else if (result.pass === 'warning') {
          categoryScores[def.category].passed += def.weight * 0.5;
        }
        categoryScores[def.category].total++;
      } catch (e) {
        console.error('[SEO Checker] Error in check', def.id, e);
      }
    });
    
    // Calculate overall score
    let totalWeight = 0;
    let totalPassed = 0;
    Object.values(categoryScores).forEach(cat => {
      totalWeight += cat.weight;
      totalPassed += cat.passed;
    });
    const overallScore = totalWeight > 0 ? Math.round((totalPassed / totalWeight) * 100) : 0;
    
    return { results, categoryScores, overallScore };
  }

  /**
   * Update the UI with results
   */
  function updateUI(data) {
    const panel = document.getElementById('seo-checker-panel');
    if (!panel) return;
    
    // Update score
    const scoreEl = panel.querySelector('.seo-score-value');
    const scoreCircle = panel.querySelector('.seo-score-circle');
    if (scoreEl) {
      scoreEl.textContent = data.overallScore;
      // Update circle color based on score
      if (scoreCircle) {
        scoreCircle.classList.remove('score-good', 'score-warning', 'score-bad');
        if (data.overallScore >= 80) scoreCircle.classList.add('score-good');
        else if (data.overallScore >= 50) scoreCircle.classList.add('score-warning');
        else scoreCircle.classList.add('score-bad');
      }
    }
    
    // Update category tabs with counts
    const categories = ['meta', 'headings', 'content', 'links', 'images', 'structured', 'url'];
    categories.forEach(cat => {
      const tab = panel.querySelector('[data-category="' + cat + '"]');
      if (tab) {
        const catResults = data.results.filter(r => r.category === cat);
        const passed = catResults.filter(r => r.result.pass === true).length;
        const warnings = catResults.filter(r => r.result.pass === 'warning').length;
        const failed = catResults.filter(r => r.result.pass === false).length;
        
        const badge = tab.querySelector('.seo-tab-badge');
        if (badge) {
          if (failed > 0) {
            badge.className = 'seo-tab-badge badge-fail';
            badge.textContent = failed;
          } else if (warnings > 0) {
            badge.className = 'seo-tab-badge badge-warning';
            badge.textContent = warnings;
          } else {
            badge.className = 'seo-tab-badge badge-pass';
            badge.textContent = passed;
          }
        }
      }
    });
    
    // Update check results
    const resultsContainer = panel.querySelector('.seo-results');
    if (resultsContainer) {
      resultsContainer.innerHTML = '';
      
      categories.forEach(cat => {
        const catResults = data.results.filter(r => r.category === cat);
        if (catResults.length === 0) return;
        
        const section = document.createElement('div');
        section.className = 'seo-category-section';
        section.setAttribute('data-cat', cat);
        
        catResults.forEach(item => {
          const el = document.createElement('div');
          el.className = 'seo-check-item';
          
          let statusClass = 'check-pass';
          let statusIcon = '✓';
          if (item.result.pass === false) {
            statusClass = 'check-fail';
            statusIcon = '✗';
          } else if (item.result.pass === 'warning') {
            statusClass = 'check-warning';
            statusIcon = '!';
          }
          
          el.innerHTML = 
            '<div class="seo-check-status ' + statusClass + '">' + statusIcon + '</div>' +
            '<div class="seo-check-content">' +
              '<div class="seo-check-name">' + item.name + '</div>' +
              '<div class="seo-check-message">' + item.result.message + '</div>' +
            '</div>' +
            '<div class="seo-check-value">' + item.result.value + '</div>';
          
          section.appendChild(el);
        });
        
        resultsContainer.appendChild(section);
      });
    }
    
    // Show first category by default
    showCategory('meta');
  }

  /**
   * Show a specific category
   */
  function showCategory(cat) {
    const panel = document.getElementById('seo-checker-panel');
    if (!panel) return;
    
    // Update active tab
    panel.querySelectorAll('.seo-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.category === cat);
    });
    
    // Show relevant results
    panel.querySelectorAll('.seo-category-section').forEach(section => {
      section.style.display = section.dataset.cat === cat ? 'block' : 'none';
    });
  }

  /**
   * Initialize SEO Checker
   */
  function init() {
    const panel = document.getElementById('seo-checker-panel');
    if (!panel) return;
    
    // Toggle panel visibility
    const toggleBtn = document.getElementById('seo-checker-toggle');
    const closeBtn = panel.querySelector('.seo-panel-close');
    
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function(e) {
        e.preventDefault();
        panel.classList.toggle('open');
        if (panel.classList.contains('open')) {
          const data = runAllChecks();
          updateUI(data);
        }
      });
    }
    
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        panel.classList.remove('open');
      });
    }
    
    // Tab switching
    panel.querySelectorAll('.seo-tab').forEach(tab => {
      tab.addEventListener('click', function() {
        showCategory(this.dataset.category);
      });
    });
    
    // Refresh button
    const refreshBtn = panel.querySelector('.seo-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function() {
        const data = runAllChecks();
        updateUI(data);
      });
    }
    
    // Also listen for toolbar SEO link click
    document.addEventListener('click', function(e) {
      const link = e.target.closest('a[href="#seo-checker"]');
      if (link) {
        e.preventDefault();
        panel.classList.add('open');
        const data = runAllChecks();
        updateUI(data);
      }
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;

module.exports = analyzerScript;

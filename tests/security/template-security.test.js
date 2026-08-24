const request = require('supertest');
const { createApp } = require('../../src/server');
const { createHelpers } = require('../../src/helpers');
const { createTranslator } = require('../../src/file-router');
const path = require('path');

const PAGES_DIR = path.join(__dirname, '../fixtures/route-order/pages');
const VIEWS_DIR = path.join(__dirname, '../fixtures/route-order/views');

describe('Security: SSR & Template Security', () => {
  it('json filter should escape angle brackets to prevent </script> injection in script blocks', () => {
    const { nunjucksEnv } = createApp({
      pagesDir: PAGES_DIR,
      viewsDir: VIEWS_DIR,
    });

    const malicious = { payload: '</script><script>alert("xss")</script>' };
    const renderedSafe = nunjucksEnv.renderString('{{ data | json | safe }}', { data: malicious });

    expect(renderedSafe).not.toContain('</script>');
    expect(renderedSafe).toContain('\\u003c/script\\u003e');

    const renderedAuto = nunjucksEnv.renderString('{{ data | json }}', { data: malicious });
    expect(renderedAuto).not.toContain('</script>');
  });

  it('AssetManager buildAttributes should filter out malicious attribute names', () => {
    const helpers = createHelpers({ req: { path: '/', query: {}, headers: {} } });
    const imgHtml = helpers.img('/logo.png', 'Logo', {
      'onclick="alert(1)"': 'bad',
      'valid-data-id': '123',
    });

    expect(imgHtml).not.toContain('onclick="alert(1)"');
    expect(imgHtml).toContain('valid-data-id="123"');
  });

  it('i18n translator should safely interpolate values without treating $ as replacement patterns', () => {
    const translations = {
      greeting: 'Hello, {{name}}! Welcome to {{site}}.',
    };

    const t = createTranslator(translations);

    const res1 = t('greeting', { name: "$' (after)", site: 'Webspresso' });
    expect(res1).toBe("Hello, $' (after)! Welcome to Webspresso.");

    const res2 = t('greeting', { name: '$$100', site: 'Webspresso' });
    expect(res2).toBe('Hello, $$100! Welcome to Webspresso.');
  });
});

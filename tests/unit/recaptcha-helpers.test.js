/**
 * reCAPTCHA Nunjucks helper output (HTML/JS escaping)
 */
const {
  recaptchaScriptTag,
  recaptchaV2WidgetHtml,
  recaptchaV3ExecuteScript,
} = require('../../plugins/recaptcha/helpers');

describe('recaptcha helpers', () => {
  it('recaptchaScriptTag adds render query when given', () => {
    expect(recaptchaScriptTag()).toContain('api.js"></script>');
    expect(recaptchaScriptTag('my&key')).toContain(encodeURIComponent('my&key'));
  });

  it('recaptchaV2WidgetHtml returns comment without siteKey', () => {
    expect(recaptchaV2WidgetHtml({})).toContain('missing siteKey');
  });

  it('recaptchaV2WidgetHtml escapes attributes and optional tabindex', () => {
    const html = recaptchaV2WidgetHtml({
      siteKey: 'k"><x',
      theme: 'dark',
      size: 'compact',
      tabindex: 2,
    });
    expect(html).toContain('&quot;');
    expect(html).not.toContain('"><x"');
    expect(html).toContain('data-tabindex="2"');
  });

  it('recaptchaV3ExecuteScript requires siteKey and action', () => {
    expect(recaptchaV3ExecuteScript({ siteKey: 'a' })).toContain('siteKey and action required');
    expect(recaptchaV3ExecuteScript({ action: 'login' })).toContain('siteKey and action required');
  });

  it('recaptchaV3ExecuteScript embeds escaped key and action', () => {
    const out = recaptchaV3ExecuteScript({
      siteKey: "ab\\c'd",
      action: "e'f",
      inputId: 'tok"><id',
      inputName: 'g-recaptcha-response',
    });
    expect(out).toContain('type="hidden"');
    expect(out).toContain('tok&quot;&gt;&lt;id');
    expect(out).toContain("getElementById('tok&quot;&gt;&lt;id')");
  });
});

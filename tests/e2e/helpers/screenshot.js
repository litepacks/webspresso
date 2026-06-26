/**
 * Save Playwright screenshots for E2E documentation / debugging.
 */

const fs = require('fs');
const path = require('path');

const SCREENSHOT_ROOT = path.join(__dirname, '..', 'screenshots');

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} suite - e.g. 'content'
 * @param {string} name - file base name without extension
 * @param {import('@playwright/test').TestInfo} [testInfo]
 */
async function captureStepScreenshot(page, suite, name, testInfo) {
  const dir = path.join(SCREENSHOT_ROOT, suite);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  if (testInfo) {
    await testInfo.attach(name, { path: filePath, contentType: 'image/png' });
  }
  return filePath;
}

module.exports = { captureStepScreenshot, SCREENSHOT_ROOT };

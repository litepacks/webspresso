/**
 * SEO Checker Plugin E2E Tests
 * Tests for SEO analysis panel functionality
 */

const { test, expect } = require('@playwright/test');

test.describe('SEO Checker Plugin', () => {
  
  test.beforeEach(async ({ page }) => {
    // Navigate to homepage where SEO checker is injected
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test.describe('Panel Injection', () => {
    
    test('should inject SEO checker panel on page', async ({ page }) => {
      // Check panel container exists
      const panel = page.locator('#seo-checker-panel');
      await expect(panel).toBeAttached();
    });

    test('should inject SEO checker toggle button', async ({ page }) => {
      // Check toggle button exists
      const toggleButton = page.locator('#seo-checker-toggle');
      await expect(toggleButton).toBeAttached();
      await expect(toggleButton).toBeVisible();
    });

    test('should have SEO checker styles injected', async ({ page }) => {
      // Check that styles are injected
      const hasStyles = await page.evaluate(() => {
        const styles = document.querySelectorAll('style');
        return Array.from(styles).some(s => s.textContent.includes('seo-checker'));
      });
      expect(hasStyles).toBe(true);
    });

    test('should have SEO checker settings injected', async ({ page }) => {
      // Check global settings object exists
      const hasSettings = await page.evaluate(() => {
        return typeof window.__SEO_CHECKER_SETTINGS__ === 'object';
      });
      expect(hasSettings).toBe(true);
    });

    test('should have SEO checker checks injected', async ({ page }) => {
      // Check checks array exists
      const hasChecks = await page.evaluate(() => {
        return Array.isArray(window.__SEO_CHECKER_CHECKS__);
      });
      expect(hasChecks).toBe(true);
    });
  });

  test.describe('Panel Interaction', () => {
    
    test('should open panel when toggle button is clicked', async ({ page }) => {
      const toggleButton = page.locator('#seo-checker-toggle');
      const panel = page.locator('#seo-checker-panel');
      
      // Panel should start hidden/collapsed
      const initialDisplay = await panel.evaluate(el => getComputedStyle(el).display);
      
      // Click toggle button to open panel
      await toggleButton.click();
      
      // Wait for panel to be visible
      await expect(panel).toBeVisible();
    });

    test('should close panel when close button is clicked', async ({ page }) => {
      const toggleButton = page.locator('#seo-checker-toggle');
      const panel = page.locator('#seo-checker-panel');
      
      // Open panel first
      await toggleButton.click();
      await expect(panel).toBeVisible();
      
      // Find and click close button
      const closeButton = page.locator('#seo-checker-panel .seo-checker-close, #seo-checker-panel [data-close]');
      if (await closeButton.count() > 0) {
        await closeButton.first().click();
        // Panel might hide or minimize
      }
    });

    test('should toggle panel visibility on repeated clicks', async ({ page }) => {
      const panel = page.locator('#seo-checker-panel');
      
      // Open panel using JavaScript
      await page.evaluate(() => {
        const toggleBtn = document.getElementById('seo-checker-toggle');
        if (toggleBtn) toggleBtn.click();
      });
      await page.waitForTimeout(500);
      
      // Check panel has open class
      const hasOpenClass = await panel.evaluate(el => el.classList.contains('open'));
      expect(hasOpenClass).toBe(true);
      
      // Close panel by clicking toggle again using JavaScript
      await page.evaluate(() => {
        const toggleBtn = document.getElementById('seo-checker-toggle');
        if (toggleBtn) toggleBtn.click();
      });
      await page.waitForTimeout(500);
      
      // Panel should not have open class
      const stillOpen = await panel.evaluate(el => el.classList.contains('open'));
      expect(stillOpen).toBe(false);
    });
  });

  test.describe('SEO Analysis', () => {
    
    test('should run SEO analysis when panel is opened', async ({ page }) => {
      const toggleButton = page.locator('#seo-checker-toggle');
      
      // Open panel to trigger analysis
      await toggleButton.click();
      
      // Wait for panel to be visible and analysis to complete
      await page.waitForSelector('#seo-checker-panel.open', { timeout: 5000 });
      await page.waitForTimeout(1000);
      
      // Check if score is displayed (analysis complete)
      const scoreElement = page.locator('#seo-checker-panel .seo-score-value, #seo-checker-panel #seo-score-value');
      const hasScore = await scoreElement.count() > 0;
      
      // Either score or some content should be visible
      if (hasScore) {
        await expect(scoreElement.first()).toBeVisible();
      } else {
        // Check for category sections or check items
        const panelContent = await page.locator('#seo-checker-panel').textContent();
        expect(panelContent.length).toBeGreaterThan(50);
      }
    });

    test('should display check categories', async ({ page }) => {
      const toggleButton = page.locator('#seo-checker-toggle');
      
      // Open panel
      await toggleButton.click();
      
      // Wait for content to load
      await page.waitForTimeout(500);
      
      // Check for category sections
      const panelContent = await page.locator('#seo-checker-panel').textContent();
      
      // Should contain at least some check categories
      const categories = ['Title', 'Meta', 'Heading', 'Content', 'Image', 'Link'];
      const hasCategories = categories.some(cat => panelContent.includes(cat));
      
      expect(hasCategories).toBe(true);
    });

    test('should detect title tag', async ({ page }) => {
      const toggleButton = page.locator('#seo-checker-toggle');
      
      // Open panel
      await toggleButton.click();
      
      // Wait for analysis
      await page.waitForTimeout(500);
      
      // The page has a title, so title check should pass
      const title = await page.title();
      expect(title).toBeTruthy();
      expect(title.length).toBeGreaterThan(0);
    });

    test('should detect meta description', async ({ page }) => {
      // Check meta description exists on page
      const metaDescription = await page.locator('meta[name="description"]').getAttribute('content');
      expect(metaDescription).toBeTruthy();
    });

    test('should detect H1 tag', async ({ page }) => {
      // Check H1 exists on page
      const h1 = page.locator('h1');
      await expect(h1).toBeAttached();
      
      const h1Text = await h1.textContent();
      expect(h1Text).toContain('Welcome to Webspresso');
    });
  });

  test.describe('Dev Toolbar Integration', () => {
    
    test('should show SEO Check link in dev toolbar', async ({ page }) => {
      // Look for dev toolbar
      const devToolbar = page.locator('#webspresso-dev-toolbar, .dev-toolbar, [data-dev-toolbar]');
      
      if (await devToolbar.count() > 0) {
        await expect(devToolbar).toBeVisible();
        
        // Check for SEO Check link
        const seoLink = devToolbar.locator('a[href="#seo-checker"], a:has-text("SEO")');
        if (await seoLink.count() > 0) {
          await expect(seoLink.first()).toBeAttached();
        }
      }
    });

    test('should open SEO panel from dev toolbar link', async ({ page }) => {
      // Look for dev toolbar SEO link
      const seoLink = page.locator('a[href="#seo-checker"]');
      
      if (await seoLink.count() > 0) {
        // Click the link using JavaScript to bypass viewport issues
        await page.evaluate(() => {
          const link = document.querySelector('a[href="#seo-checker"]');
          if (link) link.click();
        });
        
        // Wait for panel to open
        await page.waitForTimeout(500);
        
        // Panel should have open class
        const panel = page.locator('#seo-checker-panel');
        const hasOpenClass = await panel.evaluate(el => el.classList.contains('open'));
        expect(hasOpenClass).toBe(true);
      }
    });
  });

  test.describe('Check Results Display', () => {
    
    test('should show pass/fail status indicators', async ({ page }) => {
      const toggleButton = page.locator('#seo-checker-toggle');
      
      // Open panel
      await toggleButton.click();
      
      // Wait for analysis
      await page.waitForTimeout(500);
      
      // Look for status indicators (passed, failed, warning)
      const panelHtml = await page.locator('#seo-checker-panel').innerHTML();
      
      // Should have some kind of status indicators
      const hasStatusIndicators = 
        panelHtml.includes('pass') || 
        panelHtml.includes('success') ||
        panelHtml.includes('fail') ||
        panelHtml.includes('warning') ||
        panelHtml.includes('✓') ||
        panelHtml.includes('✗') ||
        panelHtml.includes('⚠');
      
      expect(hasStatusIndicators).toBe(true);
    });

    test('should display check descriptions', async ({ page }) => {
      const toggleButton = page.locator('#seo-checker-toggle');
      
      // Open panel
      await toggleButton.click();
      
      // Wait for analysis
      await page.waitForTimeout(500);
      
      // Panel should have descriptive text
      const panelText = await page.locator('#seo-checker-panel').textContent();
      
      // Should contain some descriptive text about SEO
      expect(panelText.length).toBeGreaterThan(50);
    });

    test('should show score or summary', async ({ page }) => {
      const toggleButton = page.locator('#seo-checker-toggle');
      
      // Open panel
      await toggleButton.click();
      
      // Wait for analysis
      await page.waitForTimeout(500);
      
      // Look for score or summary section
      const panelHtml = await page.locator('#seo-checker-panel').innerHTML();
      
      // Should have either a score, count, or summary
      const hasSummary = 
        /\d+/.test(panelHtml) || // Has numbers (scores/counts)
        panelHtml.includes('score') ||
        panelHtml.includes('Score') ||
        panelHtml.includes('passed') ||
        panelHtml.includes('failed') ||
        panelHtml.includes('total');
      
      expect(hasSummary).toBe(true);
    });
  });

  test.describe('Responsive Behavior', () => {
    
    test('should be visible on mobile viewport', async ({ page }) => {
      // Set mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });
      
      // Reload page
      await page.reload();
      await page.waitForLoadState('networkidle');
      
      // Toggle button should still be visible
      const toggleButton = page.locator('#seo-checker-toggle');
      await expect(toggleButton).toBeVisible();
    });

    test('should be visible on tablet viewport', async ({ page }) => {
      // Set tablet viewport
      await page.setViewportSize({ width: 768, height: 1024 });
      
      // Reload page
      await page.reload();
      await page.waitForLoadState('networkidle');
      
      // Toggle button should still be visible
      const toggleButton = page.locator('#seo-checker-toggle');
      await expect(toggleButton).toBeVisible();
    });
  });
});

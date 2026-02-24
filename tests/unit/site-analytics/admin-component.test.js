/**
 * Admin Component Generation Tests
 */
const { generateAnalyticsComponent } = require('../../../plugins/site-analytics/admin-component');

describe('Analytics Admin Component', () => {
  let code;

  beforeAll(() => {
    code = generateAnalyticsComponent();
  });

  it('should return a non-empty string', () => {
    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(0);
  });

  it('should register AnalyticsPage on window.__customPages', () => {
    expect(code).toContain("window.__customPages['analytics']");
    expect(code).toContain('AnalyticsPage');
  });

  it('should include stat card component', () => {
    expect(code).toContain('StatCard');
  });

  it('should include Views Over Time chart', () => {
    expect(code).toContain('ViewsChart');
    expect(code).toContain('Views Over Time');
  });

  it('should include Chart.js CDN loading', () => {
    expect(code).toContain('chart.js');
    expect(code).toContain('chart.umd.min.js');
  });

  it('should include all analytics sections', () => {
    expect(code).toContain('Bot Activity');
    expect(code).toContain('Top Pages');
    expect(code).toContain('Recent Activity');
    expect(code).toContain('Country Stats');
  });

  it('should include day filter buttons (7, 30, 90)', () => {
    expect(code).toContain('Last ');
    expect(code).toContain('[7, 30, 90]');
  });

  it('should include country flags mapping', () => {
    expect(code).toContain('COUNTRY_FLAGS');
    expect(code).toContain('COUNTRY_NAMES');
  });

  it('should include API calls for all endpoints', () => {
    expect(code).toContain("analyticsApi('stats'");
    expect(code).toContain("analyticsApi('views-over-time'");
    expect(code).toContain("analyticsApi('top-pages'");
    expect(code).toContain("analyticsApi('bot-activity'");
    expect(code).toContain("analyticsApi('countries'");
    expect(code).toContain("analyticsApi('recent'");
  });

  it('should include stat card icons', () => {
    expect(code).toContain('Views');
    expect(code).toContain('Visitors');
    expect(code).toContain('Unique Pages');
    expect(code).toContain('Sessions');
  });

  it('should include HBar component for progress bars', () => {
    expect(code).toContain('HBar');
  });

  it('should wrap in an IIFE to avoid global scope pollution', () => {
    expect(code).toContain('(function()');
    expect(code).toContain('})()');
  });
});

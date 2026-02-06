/**
 * SEO Check Definitions
 * Defines all SEO checks and their configurations
 */

/**
 * Default settings for SEO checks
 */
const defaultSettings = {
  // Meta tags
  titleLength: [30, 60],
  descriptionLength: [50, 160],
  
  // Content
  minContentWords: 300,
  maxContentWords: 2500,
  keywordsInFirstWords: 50,
  
  // Links
  minInternalLinks: 1,
  minExternalLinks: 1,
  
  // URL
  maxUrlLength: 75,
  maxUrlDepth: 3,
  
  // Images
  requireAltText: true,
  requireImageDimensions: true,
  
  // Headings
  requireSingleH1: true,
  checkHeadingHierarchy: true
};

/**
 * Check definitions organized by category
 */
const checkDefinitions = [
  // ==================== META TAGS ====================
  {
    id: 'meta-title-exists',
    category: 'meta',
    name: 'Page Title',
    description: 'Page should have a title tag',
    weight: 10,
    check: 'titleExists'
  },
  {
    id: 'meta-title-length',
    category: 'meta',
    name: 'Title Length',
    description: 'Title should be between 30-60 characters for optimal display in search results',
    weight: 8,
    check: 'titleLength',
    settings: ['titleLength']
  },
  {
    id: 'meta-description-exists',
    category: 'meta',
    name: 'Meta Description',
    description: 'Page should have a meta description',
    weight: 9,
    check: 'descriptionExists'
  },
  {
    id: 'meta-description-length',
    category: 'meta',
    name: 'Description Length',
    description: 'Meta description should be between 50-160 characters',
    weight: 7,
    check: 'descriptionLength',
    settings: ['descriptionLength']
  },
  {
    id: 'meta-canonical',
    category: 'meta',
    name: 'Canonical URL',
    description: 'Page should have a canonical URL to prevent duplicate content issues',
    weight: 6,
    check: 'canonicalExists'
  },
  {
    id: 'meta-viewport',
    category: 'meta',
    name: 'Viewport Meta',
    description: 'Page should have a viewport meta tag for mobile responsiveness',
    weight: 8,
    check: 'viewportExists'
  },
  {
    id: 'meta-robots',
    category: 'meta',
    name: 'Robots Meta',
    description: 'Check robots meta tag configuration',
    weight: 5,
    check: 'robotsMeta'
  },
  {
    id: 'meta-charset',
    category: 'meta',
    name: 'Character Encoding',
    description: 'Page should declare UTF-8 character encoding',
    weight: 4,
    check: 'charsetExists'
  },
  {
    id: 'meta-lang',
    category: 'meta',
    name: 'Language Attribute',
    description: 'HTML tag should have a lang attribute',
    weight: 5,
    check: 'langExists'
  },

  // ==================== HEADINGS ====================
  {
    id: 'heading-h1-exists',
    category: 'headings',
    name: 'H1 Tag Exists',
    description: 'Page should have exactly one H1 tag',
    weight: 10,
    check: 'h1Exists'
  },
  {
    id: 'heading-h1-single',
    category: 'headings',
    name: 'Single H1',
    description: 'Page should have only one H1 tag',
    weight: 8,
    check: 'h1Single'
  },
  {
    id: 'heading-h1-first',
    category: 'headings',
    name: 'H1 Position',
    description: 'H1 should appear before other headings',
    weight: 5,
    check: 'h1First'
  },
  {
    id: 'heading-hierarchy',
    category: 'headings',
    name: 'Heading Hierarchy',
    description: 'Headings should follow a logical hierarchy (no skipping levels)',
    weight: 7,
    check: 'headingHierarchy'
  },
  {
    id: 'heading-not-empty',
    category: 'headings',
    name: 'Non-Empty Headings',
    description: 'Headings should not be empty',
    weight: 6,
    check: 'headingsNotEmpty'
  },

  // ==================== CONTENT ====================
  {
    id: 'content-word-count',
    category: 'content',
    name: 'Word Count',
    description: 'Page should have at least 300 words of content',
    weight: 8,
    check: 'wordCount',
    settings: ['minContentWords', 'maxContentWords']
  },
  {
    id: 'content-paragraphs',
    category: 'content',
    name: 'Paragraph Structure',
    description: 'Content should be organized in paragraphs',
    weight: 4,
    check: 'hasParagraphs'
  },
  {
    id: 'content-keyword-density',
    category: 'content',
    name: 'Keyword Usage',
    description: 'Check if title keywords appear in content',
    weight: 6,
    check: 'keywordInContent'
  },
  {
    id: 'content-keyword-early',
    category: 'content',
    name: 'Keywords Early',
    description: 'Important keywords should appear in first 50 words',
    weight: 5,
    check: 'keywordEarly',
    settings: ['keywordsInFirstWords']
  },

  // ==================== LINKS ====================
  {
    id: 'links-internal',
    category: 'links',
    name: 'Internal Links',
    description: 'Page should have at least 1 internal link',
    weight: 6,
    check: 'internalLinks',
    settings: ['minInternalLinks']
  },
  {
    id: 'links-external',
    category: 'links',
    name: 'External Links',
    description: 'Page should have at least 1 external link',
    weight: 4,
    check: 'externalLinks',
    settings: ['minExternalLinks']
  },
  {
    id: 'links-nofollow',
    category: 'links',
    name: 'Nofollow Links',
    description: 'Check external links for nofollow attribute',
    weight: 3,
    check: 'nofollowLinks'
  },
  {
    id: 'links-anchor-text',
    category: 'links',
    name: 'Anchor Text',
    description: 'Links should have descriptive anchor text',
    weight: 5,
    check: 'anchorText'
  },
  {
    id: 'links-broken',
    category: 'links',
    name: 'Empty Links',
    description: 'Links should have valid href attributes',
    weight: 7,
    check: 'emptyLinks'
  },

  // ==================== IMAGES ====================
  {
    id: 'images-alt',
    category: 'images',
    name: 'Alt Text',
    description: 'All images should have alt attributes',
    weight: 8,
    check: 'imageAlt'
  },
  {
    id: 'images-alt-descriptive',
    category: 'images',
    name: 'Descriptive Alt',
    description: 'Alt text should be descriptive (not just "image" or empty)',
    weight: 5,
    check: 'imageAltDescriptive'
  },
  {
    id: 'images-dimensions',
    category: 'images',
    name: 'Image Dimensions',
    description: 'Images should have width and height attributes to prevent layout shift',
    weight: 4,
    check: 'imageDimensions'
  },
  {
    id: 'images-lazy',
    category: 'images',
    name: 'Lazy Loading',
    description: 'Below-the-fold images should use lazy loading',
    weight: 3,
    check: 'imageLazy'
  },

  // ==================== STRUCTURED DATA ====================
  {
    id: 'structured-og-title',
    category: 'structured',
    name: 'Open Graph Title',
    description: 'Page should have og:title meta tag',
    weight: 5,
    check: 'ogTitle'
  },
  {
    id: 'structured-og-description',
    category: 'structured',
    name: 'Open Graph Description',
    description: 'Page should have og:description meta tag',
    weight: 5,
    check: 'ogDescription'
  },
  {
    id: 'structured-og-image',
    category: 'structured',
    name: 'Open Graph Image',
    description: 'Page should have og:image meta tag for social sharing',
    weight: 6,
    check: 'ogImage'
  },
  {
    id: 'structured-og-url',
    category: 'structured',
    name: 'Open Graph URL',
    description: 'Page should have og:url meta tag',
    weight: 4,
    check: 'ogUrl'
  },
  {
    id: 'structured-twitter-card',
    category: 'structured',
    name: 'Twitter Card',
    description: 'Page should have twitter:card meta tag',
    weight: 4,
    check: 'twitterCard'
  },
  {
    id: 'structured-json-ld',
    category: 'structured',
    name: 'JSON-LD Schema',
    description: 'Page should have structured data (JSON-LD)',
    weight: 6,
    check: 'jsonLd'
  },
  {
    id: 'structured-hreflang',
    category: 'structured',
    name: 'Hreflang Tags',
    description: 'Multi-language pages should have hreflang tags',
    weight: 4,
    check: 'hreflang'
  },

  // ==================== URL ====================
  {
    id: 'url-length',
    category: 'url',
    name: 'URL Length',
    description: 'URL should be under 75 characters',
    weight: 4,
    check: 'urlLength',
    settings: ['maxUrlLength']
  },
  {
    id: 'url-depth',
    category: 'url',
    name: 'URL Depth',
    description: 'URL should not be too deep (max 3 levels)',
    weight: 3,
    check: 'urlDepth',
    settings: ['maxUrlDepth']
  },
  {
    id: 'url-readable',
    category: 'url',
    name: 'URL Readability',
    description: 'URL should be readable and use hyphens instead of underscores',
    weight: 5,
    check: 'urlReadable'
  },
  {
    id: 'url-https',
    category: 'url',
    name: 'HTTPS',
    description: 'Page should be served over HTTPS',
    weight: 9,
    check: 'urlHttps'
  }
];

/**
 * Category definitions for UI
 */
const categories = [
  { id: 'meta', name: 'Meta Tags', icon: '📄', description: 'Page metadata and SEO tags' },
  { id: 'headings', name: 'Headings', icon: '📝', description: 'Heading structure and hierarchy' },
  { id: 'content', name: 'Content', icon: '📰', description: 'Content quality and keywords' },
  { id: 'links', name: 'Links', icon: '🔗', description: 'Internal and external links' },
  { id: 'images', name: 'Images', icon: '🖼️', description: 'Image optimization and accessibility' },
  { id: 'structured', name: 'Structured', icon: '🏗️', description: 'Structured data and social tags' },
  { id: 'url', name: 'URL', icon: '🌐', description: 'URL structure and security' }
];

module.exports = {
  defaultSettings,
  checkDefinitions,
  categories
};

/**
 * Markdown + YAML frontmatter parsing for content layer.
 */

const { parse: parseYaml } = require('yaml');
const { marked } = require('marked');
const { extractFrontmatterBlock } = require('../../src/frontmatter-block');

const EXCERPT_MAX = 160;

/**
 * Strip markdown to plain text for excerpts.
 * @param {string} md
 * @returns {string}
 */
function markdownToPlainText(md) {
  if (!md) return '';
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/#{1,6}\s+/g, '')
    .replace(/[*_~>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} text
 * @param {number} [maxLen]
 * @returns {string}
 */
function buildExcerpt(text, maxLen = EXCERPT_MAX) {
  const plain = markdownToPlainText(text);
  if (plain.length <= maxLen) return plain;
  const cut = plain.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

/**
 * @param {string} raw File contents
 * @returns {{ fm: Record<string, unknown>|null, body: string, html: string, excerpt: string }}
 */
function parseMarkdownContent(raw) {
  const { body, yamlText, extracted } = extractFrontmatterBlock(raw);

  /** @type {Record<string, unknown>|null} */
  let fm = null;
  if (extracted && yamlText != null) {
    if (yamlText === '') {
      fm = {};
    } else {
      try {
        const parsed = parseYaml(yamlText);
        fm =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch (err) {
        throw new Error(`Content frontmatter YAML parse failed: ${err.message}`);
      }
    }
  }

  const markdownBody = body || '';
  const html = marked.parse(markdownBody, { async: false });
  const excerpt = buildExcerpt(markdownBody);

  return {
    fm,
    body: markdownBody,
    html: typeof html === 'string' ? html : String(html),
    excerpt,
  };
}

module.exports = {
  parseMarkdownContent,
  buildExcerpt,
  markdownToPlainText,
  EXCERPT_MAX,
};

/**
 * Shared YAML frontmatter block extraction (--- … --- at file top).
 */

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

/**
 * @param {string} raw
 * @returns {{ body: string, yamlText: string|null, extracted: boolean }}
 */
function extractFrontmatterBlock(raw) {
  const strippedBom = raw.replace(/^\uFEFF/, '');
  const match = strippedBom.match(FRONTMATTER_BLOCK);
  if (!match) {
    return { body: strippedBom, yamlText: null, extracted: false };
  }
  const body = strippedBom.slice(match[0].length);
  const yamlText = match[1] != null ? String(match[1]).trimEnd() : '';
  return { body, yamlText, extracted: true };
}

module.exports = {
  FRONTMATTER_BLOCK,
  extractFrontmatterBlock,
};

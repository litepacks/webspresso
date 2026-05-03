/** Strip simple HTML-ish tags repeatedly (mitigates incomplete single-pass sanitization). */
function stripHtmlLikeTagsRepeated(value) {
  let s = String(value);
  let prev;
  do {
    prev = s;
    s = s.replace(/<[^>]*>/g, '');
  } while (s !== prev);
  return s;
}

/**
 * Whether rich-text content is empty after removing tags / Quill placeholders.
 * @param {string} value
 */
function isRichTextEmpty(value) {
  if (!value) return true;
  const stripped = stripHtmlLikeTagsRepeated(String(value)).trim();
  const v = String(value).trim();
  return stripped === '' || v === '<p><br></p>' || v === '<p></p>';
}

module.exports = { isRichTextEmpty, stripHtmlLikeTagsRepeated };

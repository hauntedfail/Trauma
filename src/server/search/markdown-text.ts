const FRONTMATTER_PATTERN = /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Strips a leading YAML frontmatter block (--- ... ---) from raw CONTENT.md text.
 */
export function stripFrontmatter(raw: string): string {
  return raw.replace(FRONTMATTER_PATTERN, "");
}

/**
 * Converts raw CONTENT.md or Markdown text into clean searchable plain text,
 * preserving English, Japanese, and general Unicode content.
 */
export function markdownToSearchText(markdown: string): string {
  let text = stripFrontmatter(markdown);

  // Strip HTML comments.
  text = text.replace(/<!--[\s\S]*?-->/g, " ");

  // Remove fenced code block delimiters while keeping inner code content.
  text = text.replace(/^[ \t]*(?:```+|~~~+)[^\r\n]*$/gm, " ");

  // Remove reference-style link definitions: [ref]: https://...
  text = text.replace(/^[ \t]*\[[^\]]+\]:[ \t]*\S+[^\r\n]*$/gm, " ");

  // Replace images ![alt](url "title") with their alt text.
  text = text.replace(/!\[([^\]]*)\]\((?:<[^>]*>|[^)\s]+)(?:[ \t]+"[^"]*")?\)/g, " $1 ");

  // Replace inline links [label](url "title") and [label](<url>) with their label.
  text = text.replace(/\[([^\]]+)\]\((?:<[^>]*>|[^)\s]+)(?:[ \t]+"[^"]*")?\)/g, " $1 ");

  // Replace reference links [label][ref] with their label.
  text = text.replace(/\[([^\]]+)\]\[[^\]]*\]/g, " $1 ");

  // Unwrap inline code spans while keeping the code text.
  text = text.replace(/`+([^`]+)`+/g, " $1 ");

  // Strip HTML tags, keeping inner text separated by spaces.
  text = text.replace(/<\/?[a-zA-Z][^>]*>/g, " ");

  // Remove horizontal rules.
  text = text.replace(/^[ \t]*(?:\*{3,}|-{3,}|_{3,})[ \t]*$/gm, " ");

  // Remove markdown table divider rows (e.g. | --- | :---: |).
  text = text.replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/gm, " ");

  // Strip heading markers, blockquote prefixes, list markers, and task checkboxes.
  text = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, "");
  text = text.replace(/^[ \t]*(?:>[ \t]?)+/gm, "");
  text = text.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, "");

  // Replace table pipe delimiters with spaces.
  text = text.replace(/\|/g, " ");

  // Unwrap bold, italic, and strikethrough formatting.
  text = text.replace(/(\*\*|~~)([\s\S]+?)\1/g, "$2");
  text = text.replace(/(^|[^\p{L}\p{N}_])__([\s\S]+?)__(?=[^\p{L}\p{N}_]|$)/gu, "$1$2");
  text = text.replace(/\*([^*\r\n]+)\*/g, "$1");
  text = text.replace(/(^|[^\p{L}\p{N}_])_([^_\r\n]+)_(?=[^\p{L}\p{N}_]|$)/gu, "$1$2");

  // Unescape common markdown backslash escapes.
  text = text.replace(/\\([\\`*_{}[\]()#+\-.!~|<>])/g, "$1");

  // Collapse whitespace into single spaces.
  return text.replace(/\s+/g, " ").trim();
}

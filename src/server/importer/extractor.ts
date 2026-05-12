import { Defuddle, type DefuddleResponse } from "defuddle/node";
import { parseHTML } from "linkedom";

import { isBlockedHostname } from "./host-policy";

export interface ExtractArticleInput {
  html: string;
  pageUrl: string;
}

export interface ExtractedArticle {
  title: string;
  description: string | null;
  faviconUrl: string | null;
  markdown: string;
  wordCount: number | null;
}

export type ArticleExtractor = (
  input: ExtractArticleInput,
) => Promise<ExtractedArticle>;

export class ArticleExtractionError extends Error {
  override name = "ArticleExtractionError";
}

export async function extractArticleWithDefuddle(
  input: ExtractArticleInput,
): Promise<ExtractedArticle> {
  let parsed: DefuddleResponse;
  try {
    const { document } = parseHTML(input.html);
    parsed = await Defuddle(document, input.pageUrl, {
      markdown: false,
      useAsync: false,
      includeReplies: false,
      fetch: rejectExtractorFetch,
    });
  } catch (error) {
    throw new ArticleExtractionError(
      `Defuddle extraction failed: ${formatUnknownError(error)}`,
    );
  }

  const title = normalizeMetadataText(parsed.title);
  const content = normalizeContent(parsed.content);

  return {
    title,
    description: normalizeNullableMetadataText(parsed.description),
    faviconUrl: normalizeNullableDisplayUrl(input.pageUrl, parsed.favicon),
    markdown:
      content.length > 0 ? htmlFragmentToMarkdown(content, input.pageUrl, title) : "",
    wordCount: Number.isFinite(parsed.wordCount) ? parsed.wordCount : null,
  };
}

export function readableMarkdownLength(markdown: string) {
  return markdown
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[[^\]]+]\([^)]+\)/g, "")
    .replace(/[#*_`>\-[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim().length;
}

const rejectExtractorFetch = (() =>
  Promise.reject(
    new ArticleExtractionError("Defuddle async fetch is disabled"),
  )) as unknown as typeof globalThis.fetch;

function normalizeMetadataText(value: string) {
  return normalizeInlineText(stripHtml(value));
}

function normalizeNullableMetadataText(value: string) {
  const normalized = normalizeMetadataText(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizeNullableDisplayUrl(pageUrl: string, value: string) {
  const normalized = value.trim();
  return normalized.length > 0 ? resolveSafeDisplayUrl(pageUrl, normalized) : null;
}

function normalizeContent(value: string) {
  return value.trim();
}

function htmlFragmentToMarkdown(
  html: string,
  pageUrl: string,
  title: string,
): string {
  const generatedMarkdownFragments: string[] = [];
  const protectGeneratedMarkdown = (fragment: string) => {
    const token = `%%TRAUMA_MARKDOWN_FRAGMENT_${generatedMarkdownFragments.length}%%`;
    generatedMarkdownFragments.push(fragment);
    return token;
  };
  let content = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, "");

  content = content.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = readHtmlAttribute(tag, "src");
    if (!src) {
      return "";
    }

    const alt = readHtmlAttribute(tag, "alt") ?? "";
    const resolvedSrc = resolveSafeDisplayUrl(pageUrl, src);
    if (!resolvedSrc) {
      return "";
    }

    return `\n${protectGeneratedMarkdown(
      `![${escapeMarkdownPlainText(decodeHtmlEntities(alt))}](${formatMarkdownDestination(resolvedSrc)})`,
    )}\n`;
  });

  content = content.replace(
    /<a\b[^>]*href=(["']?)([^"'\s>]+)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, _quote: string, href: string, labelHtml: string) => {
      const label = normalizeInlineText(stripHtml(labelHtml));
      if (label.length === 0) {
        return "";
      }

      const resolvedHref = resolveSafeDisplayUrl(pageUrl, href);
      if (!resolvedHref) {
        return label;
      }

      return protectGeneratedMarkdown(
        `[${escapeMarkdownPlainText(label)}](${formatMarkdownDestination(resolvedHref)})`,
      );
    },
  );

  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    const headingPattern = new RegExp(
      `<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}>`,
      "gi",
    );
    content = content.replace(headingPattern, (_match, headingHtml: string) => {
      const heading = normalizeInlineText(stripHtml(headingHtml));
      return heading.length > 0
        ? `\n${protectGeneratedMarkdown(
            `${"#".repeat(level)} ${escapeMarkdownPlainText(heading)}`,
          )}\n`
        : "\n";
    });
  }

  content = content
    .replace(/<li\b[^>]*>/gi, () => `\n${protectGeneratedMarkdown("- ")}`)
    .replace(/<\/li>/gi, "\n")
    .replace(/<(p|div|section|main|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|main|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+>/g, "");

  const lines = decodeHtmlEntities(content)
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .map((line) =>
      escapeMarkdownLinePreservingGenerated(line, generatedMarkdownFragments),
    );
  const markdown = lines.join("\n\n");

  if (markdown.length === 0) {
    return "";
  }

  if (title.length > 0 && !markdown.startsWith("# ")) {
    return `# ${escapeMarkdownPlainText(title)}\n\n${markdown}`.trim();
  }

  return markdown;
}

function stripHtml(html: string) {
  return html.replace(/<\/?[^>]+>/g, "");
}

function normalizeInlineText(value: string) {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function readHtmlAttribute(tag: string, name: string) {
  const pattern = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    "i",
  );
  const match = pattern.exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (match, hex: string) =>
      decodeNumericHtmlEntity(match, Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (match, dec: string) =>
      decodeNumericHtmlEntity(match, Number.parseInt(dec, 10)),
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'");
}

function decodeNumericHtmlEntity(match: string, codePoint: number) {
  if (
    !Number.isInteger(codePoint) ||
    codePoint < 0 ||
    codePoint > 0x10ffff
  ) {
    return match;
  }

  return String.fromCodePoint(codePoint);
}

function escapeMarkdownText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\[\]])/g, "\\$1");
}

function escapeMarkdownPlainText(value: string) {
  return escapeMarkdownText(value).replace(/([`*_{}()[\]#+\-.!|~])/g, "\\$1");
}

function escapeMarkdownLinePreservingGenerated(
  line: string,
  generatedMarkdownFragments: string[],
) {
  return restoreGeneratedMarkdown(line, generatedMarkdownFragments);
}

function restoreGeneratedMarkdown(
  value: string,
  generatedMarkdownFragments: string[],
) {
  const tokenPattern = /%%TRAUMA_MARKDOWN_FRAGMENT_(\d+)%%/g;
  let output = "";
  let lastIndex = 0;

  for (const match of value.matchAll(tokenPattern)) {
    output += escapeMarkdownPlainText(value.slice(lastIndex, match.index));
    const fragmentIndex = Number.parseInt(match[1] ?? "", 10);
    const fragment = generatedMarkdownFragments[fragmentIndex];
    output += fragment ?? escapeMarkdownPlainText(match[0]);
    lastIndex = match.index + match[0].length;
  }

  output += escapeMarkdownPlainText(value.slice(lastIndex));
  return output;
}

function resolveSafeDisplayUrl(pageUrl: string, value: string) {
  try {
    const parsed = new URL(decodeHtmlEntities(value), pageUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    if (isBlockedHostname(parsed.hostname)) {
      return null;
    }

    parsed.username = "";
    parsed.password = "";

    return parsed.toString();
  } catch {
    return null;
  }
}

function formatMarkdownDestination(url: string) {
  return url.replace(/\\/g, "%5C").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function formatUnknownError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

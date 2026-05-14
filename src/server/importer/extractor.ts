import { Defuddle, type DefuddleResponse } from "defuddle/node";
import { parseHTML } from "linkedom";

import { isBlockedHostname, normalizeHostname } from "./host-policy";

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
      content.length > 0
        ? htmlFragmentToMarkdown(
            content,
            input.pageUrl,
            title,
            collectResponsivePictureMarkup(input.html, input.pageUrl),
          )
        : "",
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
  responsivePicturesByUrl = new Map<string, string>(),
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

  content = content.replace(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi, (tag) => {
    const sourceResponsiveMarkup = findResponsivePictureForTag(
      tag,
      pageUrl,
      responsivePicturesByUrl,
    );
    if (sourceResponsiveMarkup !== null) {
      return `\n${protectGeneratedMarkdown(sourceResponsiveMarkup)}\n`;
    }

    const responsiveMarkup = pictureHtmlToResponsiveMarkup(tag, pageUrl);
    if (responsiveMarkup !== null) {
      return `\n${protectGeneratedMarkdown(responsiveMarkup)}\n`;
    }

    const fallbackImage = pictureHtmlToMarkdownImage(tag, pageUrl);
    return fallbackImage !== null
      ? `\n${protectGeneratedMarkdown(fallbackImage)}\n`
      : "";
  });

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

    const responsiveMarkup = responsivePicturesByUrl.get(resolvedSrc);
    if (responsiveMarkup !== undefined) {
      return `\n${protectGeneratedMarkdown(responsiveMarkup)}\n`;
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

function collectResponsivePictureMarkup(html: string, pageUrl: string) {
  const responsivePicturesByUrl = new Map<string, string>();
  for (const match of html.matchAll(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi)) {
    const pictureHtml = match[0];
    const responsiveMarkup = pictureHtmlToResponsiveMarkup(pictureHtml, pageUrl);
    if (responsiveMarkup === null) {
      continue;
    }

    for (const url of collectPictureDisplayUrls(pictureHtml, pageUrl)) {
      responsivePicturesByUrl.set(url, responsiveMarkup);
    }
  }

  return responsivePicturesByUrl;
}

function findResponsivePictureForTag(
  html: string,
  pageUrl: string,
  responsivePicturesByUrl: Map<string, string>,
) {
  for (const url of collectPictureDisplayUrls(html, pageUrl)) {
    const markup = responsivePicturesByUrl.get(url);
    if (markup !== undefined) {
      return markup;
    }
  }

  return null;
}

function collectPictureDisplayUrls(html: string, pageUrl: string) {
  const urls = new Set<string>();
  for (const tag of html.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const src = readHtmlAttribute(tag[0], "src");
    if (src !== null) {
      const resolvedSrc = resolveSafeDisplayUrl(pageUrl, src);
      if (resolvedSrc !== null) {
        urls.add(resolvedSrc);
      }
    }

    for (const candidate of collectSourceSetUrls(pageUrl, readHtmlAttribute(tag[0], "srcset"))) {
      urls.add(candidate);
    }
  }

  return urls;
}

function collectSourceSetUrls(pageUrl: string, value: string | null) {
  if (value === null) {
    return [];
  }

  return value
    .replace(/data:[^,\s]+,[^,\s]+(?:\s+\S+)?/gi, "")
    .split(",")
    .map((candidate) => {
      const [rawUrl] = candidate.trim().split(/\s+/).filter(Boolean);
      return rawUrl === undefined ? null : resolveSafeDisplayUrl(pageUrl, rawUrl);
    })
    .filter((url): url is string => url !== null);
}

function pictureHtmlToResponsiveMarkup(html: string, pageUrl: string) {
  const sourceTags = [...html.matchAll(/<source\b[^>]*>/gi)]
    .map((match) => sourceHtmlToResponsiveMarkup(match[0], pageUrl))
    .filter((tag): tag is string => tag !== null);
  const imageTag = /<img\b[^>]*>/i.exec(html)?.[0];
  if (imageTag === undefined) {
    return null;
  }

  const image = imageHtmlToResponsiveMarkup(imageTag, pageUrl);
  if (image === null || (sourceTags.length === 0 && image.srcset === null)) {
    return null;
  }

  return [
    "<picture>",
    ...sourceTags,
    image.markup,
    "</picture>",
  ].join("\n");
}

function pictureHtmlToMarkdownImage(html: string, pageUrl: string) {
  const imageTag = /<img\b[^>]*>/i.exec(html)?.[0];
  if (imageTag === undefined) {
    return null;
  }

  const src = readHtmlAttribute(imageTag, "src");
  if (src === null) {
    return null;
  }

  const resolvedSrc = resolveSafeDisplayUrl(pageUrl, src);
  if (resolvedSrc === null) {
    return null;
  }

  const alt = readHtmlAttribute(imageTag, "alt") ?? "";
  return `![${escapeMarkdownPlainText(decodeHtmlEntities(alt))}](${formatMarkdownDestination(resolvedSrc)})`;
}

function sourceHtmlToResponsiveMarkup(tag: string, pageUrl: string) {
  const safeSourceSet = sanitizeSourceSetForPage(
    pageUrl,
    readHtmlAttribute(tag, "srcset"),
  );
  if (safeSourceSet === null) {
    return null;
  }

  return formatHtmlVoidElement("source", {
    media: readHtmlAttribute(tag, "media"),
    sizes: readHtmlAttribute(tag, "sizes"),
    srcset: safeSourceSet,
    type: readHtmlAttribute(tag, "type"),
  });
}

function imageHtmlToResponsiveMarkup(tag: string, pageUrl: string) {
  const src = readHtmlAttribute(tag, "src");
  if (src === null) {
    return null;
  }

  const resolvedSrc = resolveSafeDisplayUrl(pageUrl, src);
  if (resolvedSrc === null) {
    return null;
  }

  const srcset = sanitizeSourceSetForPage(pageUrl, readHtmlAttribute(tag, "srcset"));

  return {
    markup: formatHtmlVoidElement("img", {
      alt: decodeHtmlEntities(readHtmlAttribute(tag, "alt") ?? ""),
      height: readHtmlAttribute(tag, "height"),
      sizes: srcset !== null ? readHtmlAttribute(tag, "sizes") : null,
      src: resolvedSrc,
      srcset,
      width: readHtmlAttribute(tag, "width"),
    }),
    srcset,
  };
}

function sanitizeSourceSetForPage(pageUrl: string, value: string | null) {
  if (value === null) {
    return null;
  }

  const candidates = value
    .replace(/data:[^,\s]+,[^,\s]+(?:\s+\S+)?/gi, "")
    .split(",")
    .map((candidate) => sanitizeSourceSetCandidateForPage(pageUrl, candidate))
    .filter((candidate): candidate is string => candidate !== null);

  return candidates.length > 0 ? candidates.join(", ") : null;
}

function sanitizeSourceSetCandidateForPage(pageUrl: string, value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const [rawUrl, descriptor] = parts;
  if (
    rawUrl === undefined ||
    descriptor === undefined ||
    parts.length !== 2 ||
    !isSafeSourceSetDescriptor(descriptor)
  ) {
    return null;
  }

  const resolvedUrl = resolveSafeDisplayUrl(pageUrl, rawUrl);
  return resolvedUrl !== null ? `${resolvedUrl} ${descriptor}` : null;
}

function isSafeSourceSetDescriptor(value: string) {
  return /^\d+w$/.test(value) || /^(?:\d+(?:\.\d+)?)x$/.test(value);
}

function formatHtmlVoidElement(
  tagName: "img" | "source",
  attrs: Record<string, string | null>,
) {
  const formattedAttrs = Object.entries(attrs)
    .filter((entry): entry is [string, string] => entry[1] !== null && entry[1] !== "")
    .map(([name, value]) => `${name}="${escapeHtmlAttribute(value)}"`);

  return `<${tagName}${formattedAttrs.length > 0 ? ` ${formattedAttrs.join(" ")}` : ""}>`;
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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

    if (!isTrustedDisplayHostname(pageUrl, parsed.hostname)) {
      return null;
    }

    parsed.username = "";
    parsed.password = "";

    return parsed.toString();
  } catch {
    return null;
  }
}

function isTrustedDisplayHostname(pageUrl: string, hostname: string) {
  const normalizedHostname = normalizeHostname(hostname);
  try {
    return normalizedHostname === normalizeHostname(new URL(pageUrl).hostname);
  } catch {
    return false;
  }
}

function formatMarkdownDestination(url: string) {
  return url.replace(/\\/g, "%5C").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function formatUnknownError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

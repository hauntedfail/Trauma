export type ImportFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface ImportUrlInput {
  url: string;
  fetch?: ImportFetch;
}

export type ImporterResult = ImporterSuccess | LinkOnlyImporterResult;

export interface ImporterSuccess {
  status: "success";
  url: string;
  title: string;
  description: string | null;
  faviconUrl: string | null;
  markdown: string;
}

export interface LinkOnlyImporterResult {
  status: "link_only";
  url: string;
  title: string;
  extractionError: string;
}

const MINIMUM_READABLE_BODY_LENGTH = 80;

export async function importUrl(input: ImportUrlInput): Promise<ImporterResult> {
  const normalizedUrl = normalizeImportUrl(input.url);
  const fetchUrl = input.fetch ?? fetch;

  let response: Response;
  try {
    response = await fetchUrl(normalizedUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml",
      },
    });
  } catch (error) {
    return linkOnly(normalizedUrl, fallbackTitleFromUrl(normalizedUrl), {
      reason: "fetch failed",
      detail: formatUnknownError(error),
    });
  }

  if (!response.ok) {
    return linkOnly(normalizedUrl, fallbackTitleFromUrl(normalizedUrl), {
      reason: "fetch failed",
      detail: `HTTP ${response.status}`,
    });
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("html")) {
    return linkOnly(normalizedUrl, fallbackTitleFromUrl(normalizedUrl), {
      reason: "unsupported content type",
      detail: contentType || "missing content-type",
    });
  }

  const html = await response.text();
  const extracted = extractReadableArticle(html, normalizedUrl);
  const title = extracted.title || fallbackTitleFromUrl(normalizedUrl);

  if (readableLength(extracted.markdown) < MINIMUM_READABLE_BODY_LENGTH) {
    return linkOnly(normalizedUrl, title, {
      reason: "insufficient article body",
    });
  }

  return {
    status: "success",
    url: normalizedUrl,
    title,
    description: extracted.description,
    faviconUrl: extracted.faviconUrl,
    markdown: extracted.markdown,
  };
}

interface ExtractedArticle {
  title: string;
  description: string | null;
  faviconUrl: string | null;
  markdown: string;
}

function extractReadableArticle(html: string, pageUrl: string): ExtractedArticle {
  const title =
    findMetaContent(html, "property", "og:title") ??
    findMetaContent(html, "name", "twitter:title") ??
    findTitle(html);
  const description =
    findMetaContent(html, "name", "description") ??
    findMetaContent(html, "property", "og:description");
  const faviconUrl = findFaviconUrl(html, pageUrl);
  const articleHtml =
    findFirstElementContent(html, "article") ?? findBody(html) ?? html;
  const markdown = htmlFragmentToMarkdown(articleHtml, pageUrl, title);

  return {
    title,
    description,
    faviconUrl,
    markdown,
  };
}

function htmlFragmentToMarkdown(
  html: string,
  pageUrl: string,
  title: string,
): string {
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
    return `\n![${escapeMarkdownText(decodeHtmlEntities(alt))}](${resolveUrl(pageUrl, src)})\n`;
  });

  content = content.replace(
    /<a\b[^>]*href=(["']?)([^"'\s>]+)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, _quote: string, href: string, labelHtml: string) => {
      const label = normalizeInlineText(stripHtml(labelHtml));
      if (label.length === 0) {
        return "";
      }

      return `[${escapeMarkdownText(label)}](${resolveUrl(pageUrl, href)})`;
    },
  );

  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    const headingPattern = new RegExp(
      `<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}>`,
      "gi",
    );
    content = content.replace(headingPattern, (_match, headingHtml: string) => {
      const heading = normalizeInlineText(stripHtml(headingHtml));
      return heading.length > 0 ? `\n${"#".repeat(level)} ${heading}\n` : "\n";
    });
  }

  content = content
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<(p|div|section|main|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|main|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+>/g, "");

  const lines = decodeHtmlEntities(content)
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0);
  const markdown = lines.join("\n\n");

  if (title.length > 0 && !markdown.startsWith("# ")) {
    return `# ${escapeMarkdownText(title)}\n\n${markdown}`.trim();
  }

  return markdown;
}

function findMetaContent(
  html: string,
  attribute: "name" | "property",
  expectedValue: string,
) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const value = readHtmlAttribute(tag, attribute);
    if (value?.toLowerCase() === expectedValue.toLowerCase()) {
      const content = readHtmlAttribute(tag, "content");
      if (content && content.trim() !== "") {
        return decodeHtmlEntities(content.trim());
      }
    }
  }

  return null;
}

function findFaviconUrl(html: string, pageUrl: string) {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const rel = readHtmlAttribute(tag, "rel");
    if (!rel?.toLowerCase().split(/\s+/).includes("icon")) {
      continue;
    }

    const href = readHtmlAttribute(tag, "href");
    if (href && href.trim() !== "") {
      return resolveUrl(pageUrl, href.trim());
    }
  }

  return null;
}

function findTitle(html: string) {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match?.[1] ? normalizeInlineText(stripHtml(match[1])) : "";
}

function findBody(html: string) {
  return findFirstElementContent(html, "body");
}

function findFirstElementContent(html: string, tagName: string) {
  const pattern = new RegExp(
    `<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
    "i",
  );
  return pattern.exec(html)?.[1] ?? null;
}

function stripHtml(html: string) {
  return html.replace(/<\/?[^>]+>/g, "");
}

function normalizeInlineText(value: string) {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function readableLength(markdown: string) {
  return markdown
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[[^\]]+]\([^)]+\)/g, "")
    .replace(/[#*_`>\-[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim().length;
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
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function escapeMarkdownText(value: string) {
  return value.replace(/([\\[\]])/g, "\\$1");
}

function normalizeImportUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("url must be an absolute HTTP(S) URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("url must use http: or https:");
  }

  return parsed.toString();
}

function resolveUrl(pageUrl: string, value: string) {
  try {
    return new URL(value, pageUrl).toString();
  } catch {
    return value;
  }
}

function fallbackTitleFromUrl(url: string) {
  const parsed = new URL(url);
  return parsed.hostname || url;
}

function linkOnly(
  url: string,
  title: string,
  error: { reason: string; detail?: string },
): LinkOnlyImporterResult {
  return {
    status: "link_only",
    url,
    title,
    extractionError: error.detail
      ? `${error.reason}: ${error.detail}`
      : error.reason,
  };
}

function formatUnknownError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

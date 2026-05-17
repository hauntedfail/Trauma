import { Defuddle, type DefuddleResponse } from "defuddle/node";
import { parseHTML } from "linkedom";

import { resolveSafeImageUrl } from "../media-policy";

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
      separateMarkdown: true,
      useAsync: false,
      includeReplies: false,
      fetch: rejectExtractorFetch,
    });
  } catch (error) {
    throw new ArticleExtractionError(
      `Defuddle extraction failed: ${formatUnknownError(error)}`,
    );
  }

  return {
    title: normalizeMetadataText(parsed.title),
    description: normalizeNullableMetadataText(parsed.description),
    faviconUrl: normalizeNullableDisplayUrl(input.pageUrl, parsed.favicon),
    markdown: normalizeContent(parsed.contentMarkdown ?? parsed.content),
    wordCount: Number.isFinite(parsed.wordCount) ? parsed.wordCount : null,
  };
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
  return normalized.length > 0 ? resolveSafeImageUrl(pageUrl, normalized) : null;
}

function normalizeContent(value: string) {
  return value.trim();
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ");
}

function normalizeInlineText(value: string) {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function formatUnknownError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

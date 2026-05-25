import { readFile } from "node:fs/promises";
import { TextDecoder } from "node:util";

import type { ResolvedTraumaConfig } from "../config";
import {
  MemoryContentStoreError,
  parseMemoryContentFixture,
  resolveMemoryContentPath,
} from "../store";
import { createSha256ContentHash, estimateRoughTokens } from "./hash";
import type { TranslationSourceSnapshot } from "./types";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export async function loadTranslationSourceSnapshot(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  memoryId: string;
}): Promise<TranslationSourceSnapshot> {
  const resolvedPath = resolveMemoryContentPath(input.config, input.memoryId);
  let bytes: Buffer;
  try {
    bytes = await readFile(resolvedPath.absolutePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new MemoryContentStoreError(
        `CONTENT.md is missing at ${resolvedPath.relativePath}`,
        "missing_content",
      );
    }
    throw error;
  }
  const rawContent = utf8Decoder.decode(bytes);
  const content = parseMemoryContentFixture(
    rawContent,
    resolvedPath.relativePath,
    input.memoryId,
  );

  return {
    byteSize: bytes.byteLength,
    documentType: inferDocumentType({
      markdown: content.markdown,
      url: content.frontmatter.url,
    }),
    memoryId: input.memoryId,
    roughTokenEstimate: estimateRoughTokens(rawContent),
    sourceHash: createSha256ContentHash(bytes),
    sourceMarkdown: rawContent,
    sourcePath: resolvedPath.relativePath,
    sourceUrl: content.frontmatter.url,
    title: content.frontmatter.title,
  };
}

function inferDocumentType(input: {
  markdown: string;
  url: string;
}): TranslationSourceSnapshot["documentType"] {
  const url = input.url.toLowerCase();
  if (url.includes("arxiv.org") || url.includes("doi.org")) {
    return "paper";
  }

  const markdown = input.markdown.toLowerCase();
  if (
    /^abstract\b/m.test(markdown) &&
    /^references\b/m.test(markdown)
  ) {
    return "paper";
  }

  return markdown.trim().length > 0 ? "article" : "unknown";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

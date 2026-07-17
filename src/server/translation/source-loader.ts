import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { TextDecoder } from "node:util";

import type { ResolvedTraumaConfig } from "../config";
import {
  MemoryContentStoreError,
  parseMemoryContentFixture,
  resolveMemoryContentPath,
} from "../store";
import { estimateRoughTokens } from "./hash";
import {
  assertTranslationSourceAdmission,
  DEFAULT_TRANSLATION_WORKLOAD_LIMITS,
} from "./limits";
import type { TranslationSourceSnapshot } from "./types";

const TRANSLATION_SOURCE_READ_CHUNK_BYTES = 64 * 1_024;

interface TranslationSourceBytes {
  byteLength: number;
  chunks: Buffer[];
}

export interface TranslationSourceFileHandle {
  close(): Promise<void>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
}

export type OpenTranslationSourceFile = (
  absolutePath: string,
) => Promise<TranslationSourceFileHandle>;

export async function loadTranslationSourceSnapshot(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  maxSourceBytes?: number;
  memoryId: string;
  openFile?: OpenTranslationSourceFile;
}): Promise<TranslationSourceSnapshot> {
  const resolvedPath = resolveMemoryContentPath(input.config, input.memoryId);
  let bytes: TranslationSourceBytes;
  try {
    bytes = await readTranslationSourceBytes({
      absolutePath: resolvedPath.absolutePath,
      maxBytes: input.maxSourceBytes ??
        DEFAULT_TRANSLATION_WORKLOAD_LIMITS.maxSourceBytes,
      openFile: input.openFile ?? openTranslationSourceFile,
    });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new MemoryContentStoreError(
        `CONTENT.md is missing at ${resolvedPath.relativePath}`,
        "missing_content",
      );
    }
    throw error;
  }
  const { rawContent, sourceHash } = decodeAndHashTranslationSource(bytes);
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
    sourceHash,
    sourceMarkdown: rawContent,
    sourcePath: resolvedPath.relativePath,
    sourceUrl: content.frontmatter.url,
    title: content.frontmatter.title,
  };
}

async function readTranslationSourceBytes(input: {
  absolutePath: string;
  maxBytes: number;
  openFile: OpenTranslationSourceFile;
}): Promise<TranslationSourceBytes> {
  if (
    !Number.isSafeInteger(input.maxBytes) ||
    input.maxBytes < 0 ||
    input.maxBytes === Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError("Translation source byte limit must be a safe integer.");
  }

  const handle = await input.openFile(input.absolutePath);
  let operationFailed = false;
  try {
    const chunks: Buffer[] = [];
    const readLimit = input.maxBytes + 1;
    let byteLength = 0;
    let reachedEndOfFile = false;
    while (byteLength < readLimit && !reachedEndOfFile) {
      const chunk = Buffer.allocUnsafe(
        Math.min(
          TRANSLATION_SOURCE_READ_CHUNK_BYTES,
          readLimit - byteLength,
        ),
      );
      let chunkByteLength = 0;
      while (chunkByteLength < chunk.byteLength) {
        const remaining = chunk.byteLength - chunkByteLength;
        const result = await handle.read(
          chunk,
          chunkByteLength,
          remaining,
          byteLength + chunkByteLength,
        );
        if (
          !Number.isSafeInteger(result.bytesRead) ||
          result.bytesRead < 0 ||
          result.bytesRead > remaining
        ) {
          throw new Error(
            "Translation source file returned an invalid read length.",
          );
        }
        if (result.bytesRead === 0) {
          reachedEndOfFile = true;
          break;
        }
        chunkByteLength += result.bytesRead;
      }
      if (chunkByteLength > 0) {
        chunks.push(chunk.subarray(0, chunkByteLength));
        byteLength += chunkByteLength;
      }
    }

    assertTranslationSourceAdmission(byteLength, {
      ...DEFAULT_TRANSLATION_WORKLOAD_LIMITS,
      maxSourceBytes: input.maxBytes,
    });
    return { byteLength, chunks };
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    try {
      await handle.close();
    } catch (closeError) {
      if (!operationFailed) {
        throw closeError;
      }
    }
  }
}

function decodeAndHashTranslationSource(input: TranslationSourceBytes): {
  rawContent: string;
  sourceHash: string;
} {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const decodedChunks: string[] = [];
  const hash = createHash("sha256");
  for (const chunk of input.chunks) {
    hash.update(chunk);
    decodedChunks.push(decoder.decode(chunk, { stream: true }));
  }
  decodedChunks.push(decoder.decode());
  return {
    rawContent: decodedChunks.join(""),
    sourceHash: `sha256:${hash.digest("hex")}`,
  };
}

async function openTranslationSourceFile(
  absolutePath: string,
): Promise<TranslationSourceFileHandle> {
  const handle = await open(absolutePath, "r");
  return {
    close: () => handle.close(),
    read: async (buffer, offset, length, position) => {
      const result = await handle.read(buffer, offset, length, position);
      return { bytesRead: result.bytesRead };
    },
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

import { dirname, join, posix, relative, resolve, sep } from "node:path";

import type { ResolvedTraumaConfig } from "../config";
import { MEMORY_CONTENT_FILENAME, MemoryContentStoreError } from "../store";
import { isSupportedLanguageCode, type SupportedLanguageCode } from "./languages";

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SAFE_TEMP_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export interface ResolvedTranslatedContentPath {
  absolutePath: string;
  memoryId: string;
  langCode: SupportedLanguageCode;
  relativePath: string;
}

export function resolveTranslatedMemoryContentPath(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  langCode: string;
  memoryId: string;
}): ResolvedTranslatedContentPath {
  assertMemoryId(input.memoryId);
  assertLanguageCode(input.langCode);

  const relativePath = posix.join(
    "memories",
    input.memoryId,
    input.langCode,
    MEMORY_CONTENT_FILENAME,
  );
  const absolutePath = join(
    resolve(input.config.storePath),
    "memories",
    input.memoryId,
    input.langCode,
    MEMORY_CONTENT_FILENAME,
  );
  assertInsideStore(input.config.storePath, absolutePath);

  return {
    absolutePath,
    langCode: input.langCode,
    memoryId: input.memoryId,
    relativePath,
  };
}

export function resolveTranslatedMemoryTempPath(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  jobId: string;
  langCode: string;
  memoryId: string;
}): string {
  const resolvedPath = resolveTranslatedMemoryContentPath(input);
  if (!SAFE_TEMP_ID_PATTERN.test(input.jobId)) {
    throw new MemoryContentStoreError(
      `translation jobId must be safe inside a temp filename: ${input.jobId}`,
      "invalid_memory_id",
    );
  }

  const tempPath = join(
    dirname(resolvedPath.absolutePath),
    `.CONTENT.${input.jobId}.tmp`,
  );
  assertInsideStore(input.config.storePath, tempPath);
  return tempPath;
}

export function resolveTranslatedMemoryProjectionPath(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  langCode: string;
  memoryId: string;
}) {
  const contentPath = resolveTranslatedMemoryContentPath(input);
  const absolutePath = join(dirname(contentPath.absolutePath), "TRANSLATION_MAP.json");
  assertInsideStore(input.config.storePath, absolutePath);

  return {
    absolutePath,
    relativePath: posix.join(
      "memories",
      input.memoryId,
      input.langCode,
      "TRANSLATION_MAP.json",
    ),
  };
}

export function createTranslatedReaderUrl(input: {
  langCode: string;
  memoryId: string;
}): string {
  assertMemoryId(input.memoryId);
  assertLanguageCode(input.langCode);
  return `/memories/${input.langCode}/${input.memoryId}`;
}

function assertMemoryId(memoryId: string): void {
  if (!UUID_V7_PATTERN.test(memoryId)) {
    throw new MemoryContentStoreError(
      `memoryId must be a UUID v7 path segment: ${memoryId}`,
      "invalid_memory_id",
    );
  }
}

function assertLanguageCode(langCode: string): asserts langCode is SupportedLanguageCode {
  if (!isSupportedLanguageCode(langCode)) {
    throw new MemoryContentStoreError(
      `unsupported translation language path segment: ${langCode}`,
      "invalid_memory_id",
    );
  }
}

function assertInsideStore(storePath: string, childPath: string): void {
  const path = relative(resolve(storePath), resolve(childPath));
  if (path === "" || path.startsWith("..") || path.includes(`..${sep}`)) {
    throw new MemoryContentStoreError(
      `translation content path must stay under storePath: ${childPath}`,
      "invalid_memory_id",
    );
  }
}

import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";

import {
  EXTRACTION_STATUSES,
  isExtractionStatus,
  type ExtractionStatus,
} from "../memory-status";
import {
  AtomicCreatePublicationError,
  createFileAtomically,
  writeFileAtomically,
  type AtomicCreateFileSystem,
} from "../files/atomic-write";

export const MEMORY_CONTENT_FILENAME = "CONTENT.md";

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FRONTMATTER_KEYS = [
  "id",
  "url",
  "title",
  "captured_at",
  "extraction_status",
] as const;

type SerializedFrontmatterKey = (typeof FRONTMATTER_KEYS)[number];
const FRONTMATTER_KEY_SET: ReadonlySet<string> = new Set(FRONTMATTER_KEYS);

export interface MemoryContentStoreConfig {
  storePath: string;
}

export interface MemoryContentFrontmatter {
  id: string;
  url: string;
  title: string;
  capturedAt: string;
  extractionStatus: ExtractionStatus;
}

export interface ResolvedMemoryContentPath {
  memoryId: string;
  relativePath: string;
  absolutePath: string;
}

export interface WriteMemoryContentInput {
  atomicCreateFileSystem?: AtomicCreateFileSystem;
  config: MemoryContentStoreConfig;
  memoryId: string;
  frontmatter: MemoryContentFrontmatter;
  markdown: string;
  overwrite?: boolean;
}

export interface WriteMemoryContentResult extends ResolvedMemoryContentPath {}

export interface ReadMemoryContentInput {
  config: MemoryContentStoreConfig;
  memoryId: string;
}

export interface DeleteMemoryContentInput {
  config: MemoryContentStoreConfig;
  memoryId: string;
}

export interface ReadMemoryContentResult extends ResolvedMemoryContentPath {
  frontmatter: MemoryContentFrontmatter;
  markdown: string;
}

export class MemoryContentStoreError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "invalid_memory_id"
      | "content_exists"
      | "content_cleanup_failed"
      | "missing_content"
      | "malformed_frontmatter",
  ) {
    super(message);
    this.name = "MemoryContentStoreError";
  }
}

export function resolveMemoryContentPath(
  config: MemoryContentStoreConfig,
  memoryId: string,
): ResolvedMemoryContentPath {
  if (!UUID_V7_PATTERN.test(memoryId)) {
    throw new MemoryContentStoreError(
      `memoryId must be a UUID v7 path segment: ${memoryId}`,
      "invalid_memory_id",
    );
  }

  const relativePath = posix.join(
    "memories",
    memoryId,
    MEMORY_CONTENT_FILENAME,
  );

  return {
    memoryId,
    relativePath,
    absolutePath: join(
      resolve(config.storePath),
      "memories",
      memoryId,
      MEMORY_CONTENT_FILENAME,
    ),
  };
}

export function createMemoryContentFixture(input: {
  frontmatter: MemoryContentFrontmatter;
  markdown: string;
}): string {
  validateFrontmatter(input.frontmatter, input.frontmatter.id);

  return [
    "---",
    ...FRONTMATTER_KEYS.map(
      (key) =>
        `${key}: ${serializeFrontmatterValue(
          getSerializedValue(input.frontmatter, key),
        )}`,
    ),
    "---",
    input.markdown,
  ].join("\n");
}

export async function writeMemoryContent(
  input: WriteMemoryContentInput,
): Promise<WriteMemoryContentResult> {
  validateFrontmatter(input.frontmatter, input.memoryId);

  const resolvedPath = resolveMemoryContentPath(input.config, input.memoryId);
  const content = createMemoryContentFixture({
    frontmatter: input.frontmatter,
    markdown: input.markdown,
  });
  const contentDir = dirname(resolvedPath.absolutePath);
  const overwrite = input.overwrite ?? true;
  await mkdir(contentDir, { recursive: true });
  let canonicalContentMayExist = false;
  try {
    await publishMemoryContent({
      atomicCreateFileSystem: input.atomicCreateFileSystem,
      content,
      destination: resolvedPath,
      overwrite,
    });
    canonicalContentMayExist = true;
    await syncMemoryDirectoryHierarchy(input.config.storePath, contentDir);
  } catch (error) {
    // The exclusive hard link can succeed before its parent fsync reports a
    // failure. Roll that observable publication back before the creation
    // journal and idempotency reservation are allowed to clear.
    if (
      !overwrite &&
      (canonicalContentMayExist || error instanceof AtomicCreatePublicationError)
    ) {
      try {
        await removeMemoryDirectoryDurably(input.config.storePath, contentDir);
      } catch (cleanupError) {
        throw new MemoryContentStoreError(
          `CONTENT.md publication failed and cleanup could not be confirmed: ${formatUnknownError(cleanupError)}`,
          "content_cleanup_failed",
        );
      }
    }
    throw error;
  }

  return resolvedPath;
}

export async function readMemoryContent(
  input: ReadMemoryContentInput,
): Promise<ReadMemoryContentResult> {
  const resolvedPath = resolveMemoryContentPath(input.config, input.memoryId);
  return readResolvedMemoryContent(resolvedPath);
}

export async function readResolvedMemoryContent(
  resolvedPath: ResolvedMemoryContentPath,
): Promise<ReadMemoryContentResult> {
  let content: string;
  try {
    content = await readFile(resolvedPath.absolutePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new MemoryContentStoreError(
        `CONTENT.md is missing at ${resolvedPath.relativePath}`,
        "missing_content",
      );
    }

    throw error;
  }

  const { frontmatter, markdown } = parseMemoryContentFixture(
    content,
    resolvedPath.relativePath,
    resolvedPath.memoryId,
  );

  return {
    ...resolvedPath,
    frontmatter,
    markdown,
  };
}

export async function deleteMemoryContent(
  input: DeleteMemoryContentInput,
): Promise<ResolvedMemoryContentPath> {
  const resolvedPath = resolveMemoryContentPath(input.config, input.memoryId);
  await rm(dirname(resolvedPath.absolutePath), {
    recursive: true,
    force: true,
  });
  await syncMemoryParentHierarchy(
    input.config.storePath,
    dirname(resolvedPath.absolutePath),
  );
  return resolvedPath;
}

export function parseMemoryContentFixture(
  content: string,
  relativePath: string,
  expectedMemoryId: string,
): { frontmatter: MemoryContentFrontmatter; markdown: string } {
  const readableContent = stripLeadingBom(content);
  const openingSeparator = /^---(?:\r?\n)/.exec(readableContent);
  if (!openingSeparator) {
    throw malformedFrontmatter(relativePath, "missing opening separator");
  }

  const contentAfterOpening = readableContent.slice(openingSeparator[0].length);
  const closingSeparator = /\r?\n---(?:\r?\n|$)/.exec(contentAfterOpening);
  if (!closingSeparator || closingSeparator.index === undefined) {
    throw malformedFrontmatter(relativePath, "missing closing separator");
  }

  const rawFrontmatter = contentAfterOpening.slice(0, closingSeparator.index);
  const markdown = contentAfterOpening.slice(
    closingSeparator.index + closingSeparator[0].length,
  );
  const serialized = parseSerializedFrontmatter(rawFrontmatter, relativePath);

  const frontmatter = {
    id: serialized.id,
    url: serialized.url,
    title: serialized.title,
    capturedAt: serialized.captured_at,
    extractionStatus: serialized.extraction_status,
  };
  validateFrontmatter(frontmatter, expectedMemoryId, relativePath);

  return { frontmatter, markdown };
}

function parseSerializedFrontmatter(
  rawFrontmatter: string,
  relativePath: string,
): Record<SerializedFrontmatterKey, string> {
  const values = new Map<string, string>();

  for (const line of rawFrontmatter.split(/\r?\n/)) {
    if (line.trim() === "") {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      throw malformedFrontmatter(relativePath, `invalid line: ${line}`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();

    if (key === "tags" || key === "categories") {
      throw malformedFrontmatter(
        relativePath,
        `${key} must stay out of CONTENT.md frontmatter`,
      );
    }

    if (!isFrontmatterKey(key)) {
      throw malformedFrontmatter(relativePath, `unsupported key: ${key}`);
    }

    if (values.has(key)) {
      throw malformedFrontmatter(relativePath, `duplicate key: ${key}`);
    }

    values.set(key, parseFrontmatterValue(rawValue, relativePath, key));
  }

  for (const key of FRONTMATTER_KEYS) {
    if (!values.has(key)) {
      throw malformedFrontmatter(relativePath, `missing key: ${key}`);
    }
  }

  return {
    id: readSerializedFrontmatterValue(values, "id", relativePath),
    url: readSerializedFrontmatterValue(values, "url", relativePath),
    title: readSerializedFrontmatterValue(values, "title", relativePath),
    captured_at: readSerializedFrontmatterValue(
      values,
      "captured_at",
      relativePath,
    ),
    extraction_status: readSerializedFrontmatterValue(
      values,
      "extraction_status",
      relativePath,
    ),
  };
}

function validateFrontmatter(
  frontmatter: {
    id: string;
    url: string;
    title: string;
    capturedAt: string;
    extractionStatus: string;
  },
  expectedMemoryId: string,
  relativePath = "CONTENT.md",
): asserts frontmatter is MemoryContentFrontmatter {
  const entries: Array<[string, string]> = [
    ["id", frontmatter.id],
    ["url", frontmatter.url],
    ["title", frontmatter.title],
    ["captured_at", frontmatter.capturedAt],
    ["extraction_status", frontmatter.extractionStatus],
  ];

  for (const [key, value] of entries) {
    if (typeof value !== "string" || value.length === 0) {
      throw malformedFrontmatter(
        relativePath,
        `${key} must be a non-empty string`,
      );
    }
  }

  if (frontmatter.id !== expectedMemoryId) {
    throw malformedFrontmatter(
      relativePath,
      `frontmatter id ${frontmatter.id} does not match memoryId ${expectedMemoryId}`,
    );
  }

  if (!isExtractionStatus(frontmatter.extractionStatus)) {
    throw malformedFrontmatter(
      relativePath,
      `extraction_status must be one of ${EXTRACTION_STATUSES.join(", ")}`,
    );
  }
}

function getSerializedValue(
  frontmatter: MemoryContentFrontmatter,
  key: SerializedFrontmatterKey,
) {
  switch (key) {
    case "id":
      return frontmatter.id;
    case "url":
      return frontmatter.url;
    case "title":
      return frontmatter.title;
    case "captured_at":
      return frontmatter.capturedAt;
    case "extraction_status":
      return frontmatter.extractionStatus;
  }
}

function serializeFrontmatterValue(value: string) {
  return JSON.stringify(value);
}

function parseFrontmatterValue(
  rawValue: string,
  relativePath: string,
  key: string,
) {
  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (typeof parsed !== "string") {
      throw new Error("not a string");
    }
    return parsed;
  } catch {
    throw malformedFrontmatter(relativePath, `${key} must be a quoted string`);
  }
}

function isFrontmatterKey(key: string): key is SerializedFrontmatterKey {
  return FRONTMATTER_KEY_SET.has(key);
}

function malformedFrontmatter(relativePath: string, detail: string) {
  return new MemoryContentStoreError(
    `CONTENT.md has malformed frontmatter at ${relativePath}: ${detail}`,
    "malformed_frontmatter",
  );
}

function readSerializedFrontmatterValue(
  values: ReadonlyMap<string, string>,
  key: SerializedFrontmatterKey,
  relativePath: string,
) {
  const value = values.get(key);
  if (value === undefined) {
    throw malformedFrontmatter(relativePath, `missing key: ${key}`);
  }

  return value;
}

async function publishMemoryContent(input: {
  atomicCreateFileSystem?: AtomicCreateFileSystem;
  content: string;
  overwrite: boolean;
  destination: ResolvedMemoryContentPath,
}): Promise<void> {
  if (!input.overwrite) {
    try {
      await createFileAtomically(input.destination.absolutePath, input.content, {
        fileSystem: input.atomicCreateFileSystem,
      });
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        throw new MemoryContentStoreError(
          `CONTENT.md already exists at ${input.destination.relativePath}`,
          "content_exists",
        );
      }
      throw error;
    }
    return;
  }

  try {
    await writeFileAtomically(input.destination.absolutePath, input.content);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      try {
        await createFileAtomically(input.destination.absolutePath, input.content);
      } catch (createError) {
        if (!isNodeError(createError) || createError.code !== "EEXIST") {
          throw createError;
        }
        await writeFileAtomically(input.destination.absolutePath, input.content);
      }
      return;
    }
    if (
      isNodeError(error) &&
      (error.code === "EEXIST" || error.code === "EPERM")
    ) {
      await rm(input.destination.absolutePath, { force: true });
      await createFileAtomically(input.destination.absolutePath, input.content);
      return;
    }
    throw error;
  }
}

async function syncMemoryDirectoryHierarchy(
  storePath: string,
  contentDirectory: string,
): Promise<void> {
  const storeRoot = resolve(storePath);
  const directories = [
    contentDirectory,
    dirname(contentDirectory),
    storeRoot,
  ];
  for (const directoryPath of new Set(directories)) {
    await syncDirectoryBestEffort(directoryPath);
  }
}

async function removeMemoryDirectoryDurably(
  storePath: string,
  contentDirectory: string,
): Promise<void> {
  await rm(contentDirectory, { recursive: true, force: true });
  await syncMemoryParentHierarchy(storePath, contentDirectory);
}

async function syncMemoryParentHierarchy(
  storePath: string,
  contentDirectory: string,
): Promise<void> {
  const storeRoot = resolve(storePath);
  for (const directoryPath of new Set([dirname(contentDirectory), storeRoot])) {
    await syncDirectoryBestEffort(directoryPath);
  }
}

async function syncDirectoryBestEffort(directoryPath: string): Promise<void> {
  let directory;
  try {
    directory = await open(directoryPath, "r");
    await directory.sync();
  } catch (error) {
    if (
      !isNodeError(error) ||
      !["EBADF", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(
        error.code ?? "",
      )
    ) {
      throw error;
    }
  } finally {
    await directory?.close().catch(() => undefined);
  }
}

function stripLeadingBom(content: string) {
  return content.startsWith("\uFEFF") ? content.slice(1) : content;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";

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

export interface MemoryContentStoreConfig {
  storePath: string;
}

export interface MemoryContentFrontmatter {
  id: string;
  url: string;
  title: string;
  capturedAt: string;
  extractionStatus: string;
}

export interface ResolvedMemoryContentPath {
  memoryId: string;
  relativePath: string;
  absolutePath: string;
}

export interface WriteMemoryContentInput {
  config: MemoryContentStoreConfig;
  memoryId: string;
  frontmatter: MemoryContentFrontmatter;
  markdown: string;
}

export interface WriteMemoryContentResult extends ResolvedMemoryContentPath {}

export interface ReadMemoryContentInput {
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
  const temporaryPath = join(
    contentDir,
    `.${MEMORY_CONTENT_FILENAME}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );
  let temporaryFileMoved = false;

  try {
    await mkdir(contentDir, { recursive: true });
    await writeFile(temporaryPath, content, "utf8");
    await replaceFile(temporaryPath, resolvedPath.absolutePath);
    temporaryFileMoved = true;
  } finally {
    if (!temporaryFileMoved) {
      await rm(temporaryPath, { force: true });
    }
  }

  return resolvedPath;
}

export async function readMemoryContent(
  input: ReadMemoryContentInput,
): Promise<ReadMemoryContentResult> {
  const resolvedPath = resolveMemoryContentPath(input.config, input.memoryId);

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
  );
  validateFrontmatter(frontmatter, input.memoryId, resolvedPath.relativePath);

  return {
    ...resolvedPath,
    frontmatter,
    markdown,
  };
}

function parseMemoryContentFixture(
  content: string,
  relativePath: string,
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

  return {
    frontmatter: {
      id: serialized.id,
      url: serialized.url,
      title: serialized.title,
      capturedAt: serialized.captured_at,
      extractionStatus: serialized.extraction_status,
    },
    markdown,
  };
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
  frontmatter: MemoryContentFrontmatter,
  expectedMemoryId: string,
  relativePath = "CONTENT.md",
) {
  const entries: Array<[keyof MemoryContentFrontmatter, string]> = [
    ["id", frontmatter.id],
    ["url", frontmatter.url],
    ["title", frontmatter.title],
    ["capturedAt", frontmatter.capturedAt],
    ["extractionStatus", frontmatter.extractionStatus],
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
  switch (key) {
    case "id":
    case "url":
    case "title":
    case "captured_at":
    case "extraction_status":
      return true;
  }

  return false;
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

async function replaceFile(sourcePath: string, destinationPath: string) {
  try {
    await rename(sourcePath, destinationPath);
  } catch (error) {
    if (
      isNodeError(error) &&
      (error.code === "EEXIST" || error.code === "EPERM")
    ) {
      await rm(destinationPath, { force: true });
      await rename(sourcePath, destinationPath);
      return;
    }

    throw error;
  }
}

function stripLeadingBom(content: string) {
  return content.startsWith("\uFEFF") ? content.slice(1) : content;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

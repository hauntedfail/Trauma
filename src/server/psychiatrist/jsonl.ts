import { appendFile, readFile, stat, writeFile } from "node:fs/promises";

import { BoundedCache } from "./bounded-cache";

interface ParsedJsonl<T> {
  hasTornTail: boolean;
  rows: T[];
  validPrefix: string;
}

const MAX_VALIDATED_JSONL_PATHS = 256;
const validatedAppendStates = new BoundedCache<string, string>(
  MAX_VALIDATED_JSONL_PATHS,
);

export async function readJsonlRows<T>(path: string): Promise<T[]> {
  const before = await readFileSignature(path);
  const content = await readJsonlContent(path);
  const parsed = parseJsonl<T>(content);
  const after = await readFileSignature(path);
  if (
    !parsed.hasTornTail &&
    (content === "" || content.endsWith("\n")) &&
    before === after &&
    after !== undefined
  ) {
    validatedAppendStates.set(path, after);
  }
  return parsed.rows;
}

export async function appendJsonlRow(path: string, row: unknown): Promise<void> {
  const signature = await readFileSignature(path);
  let prefix = "";
  if (
    signature === undefined ||
    validatedAppendStates.get(path) !== signature
  ) {
    const content = await readJsonlContent(path);
    const parsed = parseJsonl(content);
    if (parsed.hasTornTail) {
      await writeFile(path, parsed.validPrefix, "utf8");
    }
    const retainedContent = parsed.hasTornTail ? parsed.validPrefix : content;
    prefix = retainedContent !== "" && !retainedContent.endsWith("\n")
      ? "\n"
      : "";
  }
  await appendFile(path, `${prefix}${JSON.stringify(row)}\n`, "utf8");
  const updatedSignature = await readFileSignature(path);
  if (updatedSignature !== undefined) {
    validatedAppendStates.set(path, updatedSignature);
  }
}

async function readJsonlContent(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function parseJsonl<T>(content: string): ParsedJsonl<T> {
  const lastNewlineIndex = content.lastIndexOf("\n");
  const completeLines = lastNewlineIndex === -1
    ? []
    : content.slice(0, lastNewlineIndex).split("\n");
  const rows = completeLines.map((line) => JSON.parse(line) as T);
  const tail = content.slice(lastNewlineIndex + 1);
  if (tail === "") {
    return { hasTornTail: false, rows, validPrefix: content };
  }
  try {
    rows.push(JSON.parse(tail) as T);
    return { hasTornTail: false, rows, validPrefix: content };
  } catch {
    return {
      hasTornTail: true,
      rows,
      validPrefix: content.slice(0, lastNewlineIndex + 1),
    };
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function readFileSignature(path: string): Promise<string | undefined> {
  try {
    const value = await stat(path, { bigint: true });
    return `${value.dev}:${value.ino}:${value.size}:${value.mtimeNs}`;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

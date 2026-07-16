import { appendFile, readFile, writeFile } from "node:fs/promises";

interface ParsedJsonl<T> {
  hasTornTail: boolean;
  rows: T[];
  validPrefix: string;
}

export async function readJsonlRows<T>(path: string): Promise<T[]> {
  return parseJsonl<T>(await readJsonlContent(path)).rows;
}

export async function appendJsonlRow(path: string, row: unknown): Promise<void> {
  const content = await readJsonlContent(path);
  const parsed = parseJsonl(content);
  if (parsed.hasTornTail) {
    await writeFile(path, parsed.validPrefix, "utf8");
  }
  const retainedContent = parsed.hasTornTail ? parsed.validPrefix : content;
  const separator = retainedContent !== "" && !retainedContent.endsWith("\n") ? "\n" : "";
  await appendFile(path, `${separator}${JSON.stringify(row)}\n`, "utf8");
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

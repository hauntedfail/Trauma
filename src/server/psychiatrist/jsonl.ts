import { open, stat, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";

import { syncDirectoryBestEffort } from "../files/atomic-write";
import { BoundedCache } from "./bounded-cache";

interface ParsedJsonl<T> {
  hasTornTail: boolean;
  rows: T[];
  validPrefix: string;
}

interface ValidatedAppendState {
  byteLength: number;
  rowCount: number;
  signature: string;
}

type JsonlAppendPublicationOutcome =
  | { status: "durable" }
  | { cause: unknown; status: "ambiguous" };

interface JsonlFileHandle {
  close: () => Promise<void>;
  read: (
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | null,
  ) => Promise<{ bytesRead: number }>;
  sync: () => Promise<void>;
  truncate: (length?: number) => Promise<void>;
  writeFile: (data: string, encoding: BufferEncoding) => Promise<void>;
}
type JsonlDirectoryHandle = Pick<FileHandle, "close" | "sync">;
interface JsonlFileStats {
  dev: bigint;
  ino: bigint;
  mtimeNs: bigint;
  size: bigint;
}

export interface JsonlFileSystem {
  open: (path: string, flags: "a+" | "r") => Promise<JsonlFileHandle>;
  openDirectory: (path: string) => Promise<JsonlDirectoryHandle>;
  stat: (path: string, options: { bigint: true }) => Promise<JsonlFileStats>;
}

export interface JsonlLimits {
  maxBytes?: number;
  maxRows?: number;
}

interface JsonlOptions {
  fileSystem?: JsonlFileSystem;
  limits?: JsonlLimits;
}

export class JsonlLimitError extends Error {
  constructor(
    public readonly kind: "bytes" | "rows",
    message: string,
  ) {
    super(message);
    this.name = "JsonlLimitError";
  }
}

export class JsonlAppendAmbiguousError extends Error {
  constructor(
    public readonly initialCause: Error,
    public readonly reconciliationCause: Error,
  ) {
    super("JSONL append publication could not be confirmed.");
    this.name = "JsonlAppendAmbiguousError";
  }
}

const MAX_VALIDATED_JSONL_PATHS = 256;
const READ_CHUNK_BYTES = 64 * 1_024;
const validatedAppendStates = new BoundedCache<string, ValidatedAppendState>(
  MAX_VALIDATED_JSONL_PATHS,
);

const defaultFileSystem: JsonlFileSystem = {
  open: (path, flags) => open(path, flags),
  openDirectory: (path) => open(path, "r"),
  stat: (path, options) => stat(path, options),
};

export async function readJsonlRows<T>(
  path: string,
  options: JsonlOptions = {},
): Promise<T[]> {
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  validateLimits(options.limits);
  const before = await readFileSignature(path, fileSystem);
  const content = await readJsonlContent(path, options.limits, fileSystem);
  const parsed = parseJsonl<T>(content, options.limits);
  const after = await readFileSignature(path, fileSystem);
  if (
    !parsed.hasTornTail &&
    (content === "" || content.endsWith("\n")) &&
    before === after &&
    after !== undefined
  ) {
    validatedAppendStates.set(path, {
      byteLength: Buffer.byteLength(content, "utf8"),
      rowCount: parsed.rows.length,
      signature: after,
    });
  }
  return parsed.rows;
}

export async function appendJsonlRow(
  path: string,
  row: unknown,
  options: JsonlOptions = {},
): Promise<void> {
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  validateLimits(options.limits);
  const signature = await readFileSignature(path, fileSystem);
  const cached = validatedAppendStates.get(path);
  let byteLength: number;
  let rowCount: number;
  let prefix = "";
  let truncateTo: number | undefined;

  if (signature !== undefined && cached?.signature === signature) {
    byteLength = cached.byteLength;
    rowCount = cached.rowCount;
  } else {
    const content = await readJsonlContent(path, options.limits, fileSystem);
    const parsed = parseJsonl(content, options.limits);
    const retainedContent = parsed.hasTornTail ? parsed.validPrefix : content;
    byteLength = Buffer.byteLength(retainedContent, "utf8");
    rowCount = parsed.rows.length;
    if (parsed.hasTornTail) {
      truncateTo = byteLength;
    }
    prefix = retainedContent !== "" && !retainedContent.endsWith("\n")
      ? "\n"
      : "";
  }

  const serializedRow = `${prefix}${JSON.stringify(row)}\n`;
  const appendedBytes = Buffer.byteLength(serializedRow, "utf8");
  assertWithinLimit("bytes", byteLength + appendedBytes, options.limits?.maxBytes);
  assertWithinLimit("rows", rowCount + 1, options.limits?.maxRows);

  const file = await fileSystem.open(path, "a+");
  try {
    if (truncateTo !== undefined) {
      await file.truncate(truncateTo);
    }
    await file.writeFile(serializedRow, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  if (signature === undefined) {
    const publication = await publishNewJsonlFile(dirname(path), fileSystem);
    if (publication.status === "ambiguous") {
      await reconcileFirstAppendPublication({
        appendedBytes,
        byteLength,
        fileSystem,
        initialCause: publication.cause,
        limits: options.limits,
        path,
        serializedRow,
      });
    }
  }

  const updatedSignature = await readFileSignature(path, fileSystem);
  if (updatedSignature !== undefined) {
    validatedAppendStates.set(path, {
      byteLength: byteLength + appendedBytes,
      rowCount: rowCount + 1,
      signature: updatedSignature,
    });
  }
}

async function publishNewJsonlFile(
  directoryPath: string,
  fileSystem: JsonlFileSystem,
): Promise<JsonlAppendPublicationOutcome> {
  try {
    await syncDirectoryBestEffort(directoryPath, fileSystem);
    return { status: "durable" };
  } catch (cause) {
    return { cause, status: "ambiguous" };
  }
}

async function reconcileFirstAppendPublication(input: {
  appendedBytes: number;
  byteLength: number;
  fileSystem: JsonlFileSystem;
  initialCause: unknown;
  limits: JsonlLimits | undefined;
  path: string;
  serializedRow: string;
}): Promise<void> {
  let content: string;
  try {
    content = await readJsonlContent(
      input.path,
      input.limits,
      input.fileSystem,
    );
  } catch (error) {
    throw new JsonlAppendAmbiguousError(
      toDiagnosticError(input.initialCause, "Initial directory sync failed."),
      toDiagnosticError(error, "JSONL append reconciliation read failed."),
    );
  }
  const contentBytes = Buffer.from(content, "utf8");
  const serializedBytes = Buffer.from(input.serializedRow, "utf8");
  const appendEnd = input.byteLength + input.appendedBytes;
  if (
    contentBytes.length < appendEnd ||
    !contentBytes.subarray(input.byteLength, appendEnd).equals(serializedBytes)
  ) {
    throw new JsonlAppendAmbiguousError(
      toDiagnosticError(input.initialCause, "Initial directory sync failed."),
      new Error(
        "The file does not contain the fsynced JSONL append at its expected offset.",
      ),
    );
  }
  const publication = await publishNewJsonlFile(
    dirname(input.path),
    input.fileSystem,
  );
  if (publication.status === "ambiguous") {
    throw new JsonlAppendAmbiguousError(
      toDiagnosticError(input.initialCause, "Initial directory sync failed."),
      toDiagnosticError(publication.cause, "Directory sync retry failed."),
    );
  }
}

function toDiagnosticError(value: unknown, fallbackMessage: string): Error {
  return value instanceof Error ? value : new Error(fallbackMessage);
}

async function readJsonlContent(
  path: string,
  limits: JsonlLimits | undefined,
  fileSystem: JsonlFileSystem,
): Promise<string> {
  const stats = await readFileStats(path, fileSystem);
  if (stats === undefined) {
    return "";
  }
  assertWithinLimit("bytes", bigintToBoundedNumber(stats.size), limits?.maxBytes);

  let file: JsonlFileHandle;
  try {
    file = await fileSystem.open(path, "r");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES);
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) {
        break;
      }
      totalBytes += bytesRead;
      assertWithinLimit("bytes", totalBytes, limits?.maxBytes);
      chunks.push(chunk.subarray(0, bytesRead));
    }
  } finally {
    await file.close();
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

function parseJsonl<T>(
  content: string,
  limits: JsonlLimits | undefined,
): ParsedJsonl<T> {
  const lastNewlineIndex = content.lastIndexOf("\n");
  const completeLines = lastNewlineIndex === -1
    ? []
    : content.slice(0, lastNewlineIndex).split("\n");
  assertWithinLimit("rows", completeLines.length, limits?.maxRows);
  const rows = completeLines.map((line) => JSON.parse(line) as T);
  const tail = content.slice(lastNewlineIndex + 1);
  if (tail === "") {
    return { hasTornTail: false, rows, validPrefix: content };
  }
  try {
    assertWithinLimit("rows", rows.length + 1, limits?.maxRows);
    rows.push(JSON.parse(tail) as T);
    return { hasTornTail: false, rows, validPrefix: content };
  } catch (error) {
    if (error instanceof JsonlLimitError) {
      throw error;
    }
    return {
      hasTornTail: true,
      rows,
      validPrefix: content.slice(0, lastNewlineIndex + 1),
    };
  }
}

function validateLimits(limits: JsonlLimits | undefined): void {
  for (const value of [limits?.maxBytes, limits?.maxRows]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
      throw new TypeError("JSONL limits must be positive safe integers.");
    }
  }
}

function assertWithinLimit(
  kind: "bytes" | "rows",
  value: number,
  maximum: number | undefined,
): void {
  if (maximum !== undefined && value > maximum) {
    throw new JsonlLimitError(
      kind,
      `JSONL ${kind} limit exceeded (${value} > ${maximum}).`,
    );
  }
}

function bigintToBoundedNumber(value: bigint): number {
  return value > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.POSITIVE_INFINITY
    : Number(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function readFileStats(
  path: string,
  fileSystem: JsonlFileSystem,
): Promise<JsonlFileStats | undefined> {
  try {
    return await fileSystem.stat(path, { bigint: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function readFileSignature(
  path: string,
  fileSystem: JsonlFileSystem,
): Promise<string | undefined> {
  const value = await readFileStats(path, fileSystem);
  return value === undefined
    ? undefined
    : `${value.dev}:${value.ino}:${value.size}:${value.mtimeNs}`;
}

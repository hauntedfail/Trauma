import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import type { ResolvedTraumaConfig } from "../config";
import type { MemoryRepository } from "../db";
import {
  isExtractionStatus,
  type ExtractionStatus,
} from "../memory-status";
import { resolveMemoryContentPath } from "../store/memory-content";
import {
  MEMORY_DELETE_STAGING_DIRECTORY,
  MEMORY_OPERATION_JOURNAL_DIRECTORY,
} from "../store/internal-directories";

const OPERATION_JOURNAL_VERSION = 1;

export interface MemoryCreationJournal {
  version: 1;
  kind: "memory_creation";
  memory: {
    id: string;
    url: string;
    title: string;
    description: string | null;
    faviconUrl: string | null;
    contentPath: string;
    extractionStatus: ExtractionStatus;
    extractionError: string | null;
    read: false;
    backupStatus: "pending" | "disabled";
    createdAt: string;
    updatedAt: string;
  };
}

export interface MemoryDeletionJournal {
  version: 1;
  kind: "memory_deletion";
  memoryId: string;
  contentPath: string;
  stagingPath: string;
}

type MemoryOperationJournal = MemoryCreationJournal | MemoryDeletionJournal;

type RecoveryMemoryRepository = Pick<
  MemoryRepository,
  "create" | "deleteMemoryRecord" | "findById" | "updateBackupStatus"
>;

export interface InterruptedMemoryDeletionBackup {
  contentPaths: readonly string[];
  memoryId: string;
}

interface MemoryOperationRecoveryInput {
  completeMissingDeletionBackup?: (
    input: InterruptedMemoryDeletionBackup,
  ) => Promise<void>;
  config: Pick<ResolvedTraumaConfig, "backup" | "storePath">;
  memories: RecoveryMemoryRepository;
  now?: () => Date;
}

const recoveryByStorePath = new Map<string, Promise<number>>();

export function resolveMemoryDeletionStagingPath(input: {
  memoryId: string;
  storePath: string;
  uniqueSuffix?: string;
}): { absolutePath: string; relativePath: string } {
  resolveMemoryContentPath({ storePath: input.storePath }, input.memoryId);
  const relativePath = `${MEMORY_DELETE_STAGING_DIRECTORY}/${input.memoryId}-${
    input.uniqueSuffix ?? `${Date.now()}-${randomUUID()}`
  }`;
  return {
    absolutePath: resolve(input.storePath, relativePath),
    relativePath,
  };
}

export async function persistMemoryCreationJournal(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  journal: MemoryCreationJournal;
}): Promise<void> {
  validateCreationJournal(input.config, input.journal);
  await writeJournal(input.config.storePath, input.journal.memory.id, input.journal);
}

export async function persistMemoryDeletionJournal(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  journal: MemoryDeletionJournal;
}): Promise<void> {
  validateDeletionJournal(input.config, input.journal);
  await writeJournal(input.config.storePath, input.journal.memoryId, input.journal);
}

export async function clearMemoryOperationJournal(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  memoryId: string;
}): Promise<void> {
  const path = resolveJournalPath(input.config.storePath, input.memoryId);
  await rm(path, { force: true });
}

export async function recoverInterruptedMemoryOperations(
  input: MemoryOperationRecoveryInput,
): Promise<number> {
  const storePath = resolve(input.config.storePath);
  const existing = recoveryByStorePath.get(storePath);
  if (existing !== undefined) {
    return existing;
  }

  const recovery = recoverInterruptedMemoryOperationsUnlocked(input).finally(() => {
    if (recoveryByStorePath.get(storePath) === recovery) {
      recoveryByStorePath.delete(storePath);
    }
  });
  recoveryByStorePath.set(storePath, recovery);
  return recovery;
}

async function recoverInterruptedMemoryOperationsUnlocked(
  input: MemoryOperationRecoveryInput,
): Promise<number> {
  const directory = resolve(
    input.config.storePath,
    MEMORY_OPERATION_JOURNAL_DIRECTORY,
  );
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }

  let recovered = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const path = join(directory, entry.name);
    const journal = parseJournal(
      input.config,
      JSON.parse(await readFile(path, "utf8")) as unknown,
    );
    const memoryId = journal.kind === "memory_creation"
      ? journal.memory.id
      : journal.memoryId;
    if (entry.name !== `${memoryId}.json`) {
      throw new Error("memory operation journal filename does not match its memory id");
    }

    if (journal.kind === "memory_creation") {
      await recoverCreation(input, journal);
    } else {
      await recoverDeletion(input, journal);
    }
    await rm(path, { force: true });
    recovered += 1;
  }
  return recovered;
}

async function recoverCreation(
  input: MemoryOperationRecoveryInput,
  journal: MemoryCreationJournal,
): Promise<void> {
  const content = resolveMemoryContentPath(
    { storePath: input.config.storePath },
    journal.memory.id,
  );
  const existing = await input.memories.findById(journal.memory.id);
  const contentExists = await pathExists(content.absolutePath);
  if (existing !== undefined) {
    if (existing.contentPath !== journal.memory.contentPath) {
      throw new Error(
        "memory creation recovery found a row with a non-owning content path",
      );
    }
    if (!contentExists) {
      throw new Error(
        "memory creation recovery found a row but canonical content is missing",
      );
    }
    return;
  }
  if (!contentExists) {
    return;
  }
  await input.memories.create({
    ...journal.memory,
    backupStatus: input.config.backup.git.enabled ? "pending" : "disabled",
    createdAt: new Date(journal.memory.createdAt),
    updatedAt: new Date(journal.memory.updatedAt),
    lastBackupAt: null,
    lastBackupError: null,
  });
}

async function recoverDeletion(
  input: MemoryOperationRecoveryInput,
  journal: MemoryDeletionJournal,
): Promise<void> {
  const row = await input.memories.findById(journal.memoryId);
  const content = resolveMemoryContentPath(
    { storePath: input.config.storePath },
    journal.memoryId,
  );
  const stagingPath = resolve(input.config.storePath, journal.stagingPath);

  if (row === undefined) {
    await rm(stagingPath, { recursive: true, force: true });
    return;
  }
  if (row.contentPath !== content.relativePath) {
    throw new Error("memory deletion recovery refused a non-owning content path");
  }

  const canonicalDirectoryExists = await pathExists(dirname(content.absolutePath));
  const stagingDirectoryExists = await pathExists(stagingPath);
  if (!canonicalDirectoryExists && !stagingDirectoryExists) {
    if (input.config.backup.git.enabled) {
      if (input.completeMissingDeletionBackup === undefined) {
        throw new Error(
          "memory deletion recovery requires a backup-aware completion callback",
        );
      }
      await input.memories.updateBackupStatus({
        id: journal.memoryId,
        backupStatus: "pending",
        lastBackupAt: null,
        lastBackupError: null,
        updatedAt: (input.now ?? (() => new Date()))(),
      });
      await input.completeMissingDeletionBackup({
        contentPaths: [
          content.relativePath,
          `memories/${journal.memoryId}/FLASHBACKS.json`,
          `memories/${journal.memoryId}`,
        ],
        memoryId: journal.memoryId,
      });
    }
    await input.memories.deleteMemoryRecord(journal.memoryId);
    return;
  }

  if (stagingDirectoryExists) {
    if (canonicalDirectoryExists) {
      throw new Error(
        "memory deletion recovery found both canonical and staged content",
      );
    }
    await mkdir(dirname(dirname(content.absolutePath)), { recursive: true });
    await rename(stagingPath, dirname(content.absolutePath));
  }

  if (input.config.backup.git.enabled) {
    await input.memories.updateBackupStatus({
      id: journal.memoryId,
      backupStatus: "pending",
      lastBackupAt: null,
      lastBackupError: null,
      updatedAt: (input.now ?? (() => new Date()))(),
    });
  }
}

async function writeJournal(
  storePath: string,
  memoryId: string,
  journal: MemoryOperationJournal,
): Promise<void> {
  const finalPath = resolveJournalPath(storePath, memoryId);
  const directory = dirname(finalPath);
  const temporaryPath = join(directory, `.${memoryId}.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true });
  let file;
  try {
    file = await open(temporaryPath, "wx");
    await file.writeFile(`${JSON.stringify(journal, null, 2)}\n`, "utf8");
    await file.sync();
    await file.close();
    file = undefined;
    await rename(temporaryPath, finalPath);
    await syncDirectory(directory);
  } finally {
    await file?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true });
  }
}

async function syncDirectory(path: string): Promise<void> {
  let directory;
  try {
    directory = await open(path, "r");
    await directory.sync();
  } catch (error) {
    if (
      !isNodeError(error) ||
      !["EINVAL", "ENOTSUP", "EBADF"].includes(error.code)
    ) {
      throw error;
    }
  } finally {
    await directory?.close().catch(() => undefined);
  }
}

function resolveJournalPath(storePath: string, memoryId: string): string {
  resolveMemoryContentPath({ storePath }, memoryId);
  return resolve(
    storePath,
    MEMORY_OPERATION_JOURNAL_DIRECTORY,
    `${memoryId}.json`,
  );
}

function parseJournal(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  value: unknown,
): MemoryOperationJournal {
  if (!isRecord(value) || value.version !== OPERATION_JOURNAL_VERSION) {
    throw new Error("unsupported memory operation journal");
  }
  if (value.kind === "memory_creation") {
    validateCreationJournal(config, value);
    return value;
  }
  if (value.kind === "memory_deletion") {
    validateDeletionJournal(config, value);
    return value;
  }
  throw new Error("unsupported memory operation journal kind");
}

function validateCreationJournal(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  value: unknown,
): asserts value is MemoryCreationJournal {
  if (!isRecord(value) || value.version !== 1 || value.kind !== "memory_creation") {
    throw new Error("invalid memory creation journal");
  }
  const memory = value.memory;
  if (
    !isRecord(memory) ||
    typeof memory.id !== "string" ||
    typeof memory.url !== "string" ||
    typeof memory.title !== "string" ||
    !isNullableString(memory.description) ||
    !isNullableString(memory.faviconUrl) ||
    typeof memory.contentPath !== "string" ||
    typeof memory.extractionStatus !== "string" ||
    !isExtractionStatus(memory.extractionStatus) ||
    !isNullableString(memory.extractionError) ||
    memory.read !== false ||
    !["pending", "disabled"].includes(String(memory.backupStatus)) ||
    !isIsoDate(memory.createdAt) ||
    !isIsoDate(memory.updatedAt)
  ) {
    throw new Error("invalid memory creation journal payload");
  }
  const expected = resolveMemoryContentPath(
    { storePath: config.storePath },
    memory.id,
  );
  if (memory.contentPath !== expected.relativePath) {
    throw new Error(
      "memory creation journal content path is not owned by its memory",
    );
  }
}

function validateDeletionJournal(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  value: unknown,
): asserts value is MemoryDeletionJournal {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.kind !== "memory_deletion" ||
    typeof value.memoryId !== "string" ||
    typeof value.contentPath !== "string" ||
    typeof value.stagingPath !== "string"
  ) {
    throw new Error("invalid memory deletion journal");
  }
  const expected = resolveMemoryContentPath(
    { storePath: config.storePath },
    value.memoryId,
  );
  if (value.contentPath !== expected.relativePath) {
    throw new Error("memory deletion journal content path is not owned by its memory");
  }
  const stagingRoot = resolve(
    config.storePath,
    MEMORY_DELETE_STAGING_DIRECTORY,
  );
  const stagingPath = resolve(config.storePath, value.stagingPath);
  if (!isInside(stagingRoot, stagingPath)) {
    throw new Error(
      "memory deletion journal staging path escapes its staging directory",
    );
  }
  const stagingName = relative(stagingRoot, stagingPath).split(sep).join("/");
  if (!stagingName.startsWith(`${value.memoryId}-`) || stagingName.includes("/")) {
    throw new Error(
      "memory deletion journal staging path is not owned by its memory",
    );
  }
}

function isInside(root: string, candidate: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate));
  return relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(
  error: unknown,
): error is NodeJS.ErrnoException & { code: string } {
  return isRecord(error) && typeof error.code === "string";
}

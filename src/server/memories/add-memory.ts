import type { ResolvedTraumaConfig } from "../config";
import type { MemoryBackupQueue } from "../backup";
import { assertBackupEnvironmentReady } from "../backup/environment";
import { importUrl, type ImporterResult } from "../importer";
import type { TraumaDatabase } from "../db";
import {
  deleteMemoryContent,
  writeMemoryContent,
} from "../store/memory-content";
import { generateMemoryId } from "./id";
import { createRepositories } from "../db/repositories";

export interface MemoryImporter {
  importUrl: (input: { url: string }) => Promise<ImporterResult>;
}

export interface AddMemoryInput {
  url: string;
  config: ResolvedTraumaConfig;
  db: TraumaDatabase;
  importer?: MemoryImporter;
  backupQueue: MemoryBackupQueue;
  generateId?: () => string;
  now?: () => Date;
}

export async function addMemory(input: AddMemoryInput) {
  await assertBackupEnvironmentReady({
    config: input.config,
    db: input.db,
  });

  const id = (input.generateId ?? generateMemoryId)();
  const capturedAt = (input.now ?? (() => new Date()))();
  const importer = input.importer ?? { importUrl };
  const imported = await importer.importUrl({ url: input.url });
  const markdown =
    imported.status === "success"
      ? imported.markdown
      : formatFallbackMarkdownLink(imported.url);
  const written = await writeMemoryContent({
    config: { storePath: input.config.storePath },
    memoryId: id,
    overwrite: false,
    frontmatter: {
      id,
      url: imported.url,
      title: imported.title,
      capturedAt: capturedAt.toISOString(),
      extractionStatus: imported.status,
    },
    markdown,
  });
  const repositories = createRepositories(input.db);
  const initialBackupStatus = input.config.backup.git.enabled ? "pending" : "disabled";

  let memory;
  try {
    memory = await repositories.memories.create({
      id,
      url: imported.url,
      title: imported.title,
      description: imported.status === "success" ? imported.description : null,
      faviconUrl: imported.status === "success" ? imported.faviconUrl : null,
      contentPath: written.relativePath,
      extractionStatus: imported.status,
      extractionError:
        imported.status === "link_only" ? imported.extractionError : null,
      read: false,
      backupStatus: initialBackupStatus,
      lastBackupAt: null,
      lastBackupError: null,
      createdAt: capturedAt,
      updatedAt: capturedAt,
    });
  } catch (error) {
    await deleteMemoryContent({
      config: { storePath: input.config.storePath },
      memoryId: id,
    });
    throw error;
  }

  if (input.config.backup.git.enabled) {
    let queued;
    try {
      queued = await input.backupQueue.enqueue({
        memoryId: id,
        contentPaths: [written.relativePath],
        reason: "memory_creation",
      });
    } catch (error) {
      try {
        const backupUpdate = await repositories.memories.updateBackupStatus({
          id,
          backupStatus: "failed",
          lastBackupAt: null,
          lastBackupError: formatUnknownError(error),
          updatedAt: capturedAt,
        });
        return { ...memory, ...backupUpdate };
      } catch {
        return memory;
      }
    }

    try {
      const backupUpdate = await repositories.memories.updateBackupStatus({
        id,
        backupStatus: queued.backupStatus,
        lastBackupAt: null,
        lastBackupError: null,
        updatedAt: capturedAt,
      });
      return { ...memory, ...backupUpdate };
    } catch {
      return memory;
    }
  }

  return memory;
}

function formatFallbackMarkdownLink(url: string) {
  return `[${escapeMarkdownLinkLabel(url)}](<${escapeMarkdownDestination(url)}>)`;
}

function escapeMarkdownLinkLabel(value: string) {
  return value.replace(/([\\[\]])/g, "\\$1");
}

function escapeMarkdownDestination(value: string) {
  return value.replaceAll("<", "%3C").replaceAll(">", "%3E");
}

function formatUnknownError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

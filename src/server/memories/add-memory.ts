import type { ResolvedTraumaConfig } from "../config";
import {
  runSerializedGitBackupJob,
  type MemoryBackupQueue,
} from "../backup";
import {
  assertBackupEnvironmentReady,
  redactOperationalError,
} from "../backup/environment";
import { importUrl, type ImporterResult } from "../importer";
import type { TraumaDatabase } from "../db";
import {
  deleteMemoryContent,
  resolveMemoryContentPath,
  writeMemoryContent,
} from "../store/memory-content";
import { generateMemoryId } from "./id";
import { createRepositories } from "../db/repositories";
import {
  clearMemoryOperationJournal,
  persistMemoryCreationJournal,
  recoverInterruptedMemoryOperations,
} from "./operation-journal";

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
  const repositories = createRepositories(input.db);
  await recoverInterruptedMemoryOperations({
    completeMissingDeletionBackup: async (deletion) => {
      await assertBackupEnvironmentReady({
        config: input.config,
        db: input.db,
      });
      await runSerializedGitBackupJob({
        config: input.config,
        job: { ...deletion, reason: "memory_deletion" },
      });
    },
    config: input.config,
    memories: repositories.memories,
  });
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
  const initialBackupStatus = input.config.backup.git.enabled ? "pending" : "disabled";
  const contentPath = resolveMemoryContentPath(
    { storePath: input.config.storePath },
    id,
  );
  const creationJournal = {
    version: 1,
    kind: "memory_creation",
    memory: {
      id,
      url: imported.url,
      title: imported.title,
      description: imported.status === "success" ? imported.description : null,
      faviconUrl: imported.status === "success" ? imported.faviconUrl : null,
      contentPath: contentPath.relativePath,
      extractionStatus: imported.status,
      extractionError:
        imported.status === "link_only" ? imported.extractionError : null,
      read: false,
      backupStatus: initialBackupStatus,
      createdAt: capturedAt.toISOString(),
      updatedAt: capturedAt.toISOString(),
    },
  } as const;
  await persistMemoryCreationJournal({
    config: input.config,
    journal: creationJournal,
  });

  let memory;
  let written: Awaited<ReturnType<typeof writeMemoryContent>>;
  let contentWritten = false;
  try {
    written = await writeMemoryContent({
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
    contentWritten = true;
    memory = await repositories.memories.create({
      ...creationJournal.memory,
      createdAt: capturedAt,
      updatedAt: capturedAt,
      lastBackupAt: null,
      lastBackupError: null,
    });
  } catch (error) {
    try {
      if (contentWritten) {
        await deleteMemoryContent({
          config: { storePath: input.config.storePath },
          memoryId: id,
        });
      }
      await clearMemoryOperationJournal({
        config: input.config,
        memoryId: id,
      });
    } catch {
      // Keep the journal when cleanup fails so startup recovery can reconcile
      // the content file and SQLite row instead of leaving an orphan.
    }
    throw error;
  }
  await clearMemoryOperationJournal({
    config: input.config,
    memoryId: id,
  }).catch(() => undefined);

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
          lastBackupError: redactOperationalError(formatUnknownError(error)),
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

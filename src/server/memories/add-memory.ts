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
  MemoryContentStoreError,
  resolveMemoryContentPath,
  writeMemoryContent,
} from "../store/memory-content";
import { assertMemoryId, generateMemoryId } from "./id";
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
  idempotencyKey?: string;
  generateId?: () => string;
  now?: () => Date;
}

interface ActiveIdempotentAdd {
  promise: ReturnType<typeof addMemoryWithId>;
  requestUrl: string;
}

const idempotentAdds = new Map<string, ActiveIdempotentAdd>();

export class AddMemoryIdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency-Key was already used for a different URL");
    this.name = "AddMemoryIdempotencyConflictError";
  }
}

export class AddMemoryIdempotencyReplayError extends Error {
  constructor() {
    super("Idempotency-Key no longer refers to an existing memory");
    this.name = "AddMemoryIdempotencyReplayError";
  }
}

export function addMemory(input: AddMemoryInput) {
  const id = input.idempotencyKey ?? (input.generateId ?? generateMemoryId)();
  assertMemoryId(id);
  if (input.idempotencyKey === undefined) {
    return addMemoryWithId(input, id, false);
  }

  const reservationKey = `${input.config.databasePath}\0${id}`;
  const active = idempotentAdds.get(reservationKey);
  if (active !== undefined) {
    if (active.requestUrl !== input.url) {
      return Promise.reject(new AddMemoryIdempotencyConflictError());
    }
    return active.promise;
  }

  const reserved = addMemoryWithId(input, id, true).finally(() => {
    if (idempotentAdds.get(reservationKey)?.promise === reserved) {
      idempotentAdds.delete(reservationKey);
    }
  });
  idempotentAdds.set(reservationKey, {
    promise: reserved,
    requestUrl: input.url,
  });
  return reserved;
}

async function addMemoryWithId(
  input: AddMemoryInput,
  id: string,
  reuseExisting: boolean,
) {
  const repositories = createRepositories(input.db);
  const capturedAt = (input.now ?? (() => new Date()))();
  let createdReservation = false;
  let retainReservationForRecovery = false;
  try {
    if (reuseExisting) {
      const reservation = await repositories.memories.reserveCreationIdempotency({
        idempotencyKey: id,
        requestUrl: input.url,
        createdAt: capturedAt,
      });
      if (
        reservation.status === "memory_id_exists" ||
        reservation.requestUrl !== input.url
      ) {
        throw new AddMemoryIdempotencyConflictError();
      }
      createdReservation = reservation.status === "new_reservation";
      const existing = await repositories.memories.findById(id);
      if (existing !== undefined) {
        return existing;
      }
    }
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
    if (reuseExisting) {
      const recovered = await repositories.memories.findById(id);
      if (recovered !== undefined) {
        return recovered;
      }
      if (!createdReservation) {
        throw new AddMemoryIdempotencyReplayError();
      }
    }
    await assertBackupEnvironmentReady({
      config: input.config,
      db: input.db,
    });

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
    retainReservationForRecovery = true;

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
        if (
          contentWritten ||
          (error instanceof MemoryContentStoreError &&
            error.code === "content_cleanup_failed")
        ) {
          await deleteMemoryContent({
            config: { storePath: input.config.storePath },
            memoryId: id,
          });
        }
        await clearMemoryOperationJournal({
          config: input.config,
          memoryId: id,
        });
        retainReservationForRecovery = false;
      } catch {
        // Keep the journal and reservation when cleanup fails so startup
        // recovery can reconcile the content file and SQLite row.
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
  } catch (error) {
    if (createdReservation && !retainReservationForRecovery) {
      await repositories.memories.releaseCreationIdempotency({
        idempotencyKey: id,
        requestUrl: input.url,
      }).catch(() => undefined);
    }
    throw error;
  }
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

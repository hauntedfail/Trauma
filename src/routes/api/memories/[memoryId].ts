import { readFile } from "node:fs/promises";

import type { APIEvent } from "@solidjs/start/server";

import { getMemoryBackupQueue, type MemoryBackupQueue } from "~/server/backup";
import {
  BackupEnvironmentFailsafeError,
  toAlertDetails,
  toPublicAlertView,
} from "~/server/backup/environment";
import {
  loadRuntimeTraumaConfig,
  TraumaConfigError,
  type ResolvedTraumaConfig,
} from "~/server/config";
import { initializeDatabase } from "~/server/db";
import { authenticateApiRequest } from "~/server/http/api-auth";
import { guardMutationRequest } from "~/server/http/mutation-request";
import { deleteMemory } from "~/server/memories/delete-memory";
import {
  MemoryContentStoreError,
  resolveMemoryContentPath,
} from "~/server/store/memory-content";

export async function GET(event: APIEvent): Promise<Response> {
  const auth = authenticateApiRequest(event.request);
  if (!auth.ok) {
    return json({ error: auth.error }, { status: auth.status });
  }

  const memoryId = event.params.memoryId?.trim();
  if (memoryId === undefined || memoryId === "") {
    return json({ error: "memoryId must be a non-empty string" }, { status: 400 });
  }

  let config: ResolvedTraumaConfig;
  try {
    config = loadRuntimeTraumaConfig();
  } catch (error) {
    return json({ error: formatConfigError(error) }, { status: 500 });
  }

  const connection = initializeDatabase(config);
  try {
    const [aggregate, fullMemory, flashbacks] = await Promise.all([
      connection.repositories.memories.findReaderAggregateById(memoryId),
      connection.repositories.memories.findById(memoryId),
      connection.repositories.flashbacks.listForMemory(memoryId),
    ]);

    if (aggregate === undefined) {
      return json({ error: "memory was not found" }, { status: 404 });
    }

    const contentMarkdown = await readRawMemoryContentMarkdown(config, memoryId);

    return json(
      {
        id: aggregate.id,
        url: aggregate.url,
        title: aggregate.title,
        description: aggregate.description,
        faviconUrl: aggregate.faviconUrl,
        contentPath: aggregate.contentPath,
        extractionStatus: aggregate.extractionStatus,
        extractionError: fullMemory?.extractionError ?? null,
        backupStatus: fullMemory?.backupStatus ?? null,
        lastBackupAt: fullMemory?.lastBackupAt
          ? fullMemory.lastBackupAt.toISOString()
          : null,
        lastBackupError: fullMemory?.lastBackupError ?? null,
        read: aggregate.read,
        capturedAt: aggregate.createdAt.toISOString(),
        createdAt: aggregate.createdAt.toISOString(),
        updatedAt: aggregate.updatedAt.toISOString(),
        contentMarkdown,
        tags: aggregate.memoryTags.map((entry) => ({
          id: entry.tag.id,
          name: entry.tag.name,
        })),
        categories: aggregate.memoryCategories.map((entry) => ({
          id: entry.category.id,
          name: entry.category.name,
        })),
        flashbacks: flashbacks.map((flashback) => ({
          id: flashback.id,
          memoryId: flashback.memoryId,
          variantKind: flashback.variantKind,
          langCode: flashback.langCode,
          translationOutputHash: flashback.translationOutputHash,
          text: flashback.text,
          prefix: flashback.prefix,
          suffix: flashback.suffix,
          startOffset: flashback.startOffset,
          endOffset: flashback.endOffset,
          contentHash: flashback.contentHash,
          createdAt: flashback.createdAt.toISOString(),
        })),
        moments: aggregate.moments.map((moment) => ({
          id: moment.id,
          sectionAnchor: moment.sectionAnchor,
          sectionTitle: moment.sectionTitle,
          sectionLevel: moment.sectionLevel,
          sectionPath: moment.sectionPath,
          sectionStartOffset: moment.sectionStartOffset,
          sectionEndOffset: moment.sectionEndOffset,
          contentHash: moment.contentHash,
          createdAt: moment.createdAt.toISOString(),
        })),
      },
      { status: 200 },
    );
  } finally {
    connection.close();
  }
}

export async function DELETE(event: APIEvent): Promise<Response> {
  const guard = guardMutationRequest(event.request);
  if (!guard.ok) {
    return json({ error: guard.error }, { status: guard.status });
  }

  const memoryId = event.params.memoryId?.trim();
  if (memoryId === undefined || memoryId === "") {
    return json({ error: "memoryId must be a non-empty string" }, { status: 400 });
  }

  let config;
  try {
    config = loadRuntimeTraumaConfig();
  } catch (error) {
    return json({ error: formatConfigError(error) }, { status: 500 });
  }

  const connection = initializeDatabase(config);
  try {
    let result;
    try {
      result = await deleteMemory({
        backupQueue: resolveDeleteMemoryBackupQueueInternal({ config }),
        config,
        db: connection.db,
        memoryId,
      });
    } catch (error) {
      if (error instanceof BackupEnvironmentFailsafeError) {
        return json(
          {
            error: error.message,
            backupFailsafe: error.alert ?? null,
          },
          { status: 409 },
        );
      }

      console.error("Unexpected memory delete failure", error);
      return json({ error: "failed to delete memory" }, { status: 500 });
    }
    if (result.status === "not_found") {
      return json({ error: "memory was not found" }, { status: 404 });
    }
    if (result.status === "failed") {
      const backupFailsafe =
        await connection.repositories.backupEnvironment.getBackupFailsafeAlert();
      return json(
        {
          error: "failed to delete memory",
          ...(backupFailsafe === undefined
            ? {}
            : {
                backupFailsafe: toPublicAlertView(
                  toAlertDetails(backupFailsafe),
                ),
              }),
        },
        { status: 500 },
      );
    }
    if (result.warnings !== undefined) {
      for (const warning of result.warnings) {
        console.warn("Memory delete completed with warning", {
          kind: warning.kind,
          memoryId,
          error: warning.error,
        });
      }
    }

    return new Response(null, { status: 204 });
  } finally {
    connection.close();
  }
}

export const resolveDeleteMemoryBackupQueue =
  resolveDeleteMemoryBackupQueueInternal;

function resolveDeleteMemoryBackupQueueInternal(input: {
  config: ResolvedTraumaConfig;
  getQueue?: (config: ResolvedTraumaConfig) => MemoryBackupQueue;
}): MemoryBackupQueue | undefined {
  if (input.config.backup.git.enabled) {
    return undefined;
  }

  return (input.getQueue ?? getMemoryBackupQueue)(input.config);
}

function json(body: unknown, init: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function formatConfigError(error: unknown): string {
  if (error instanceof TraumaConfigError) {
    console.error(error.message);
  }

  return "failed to load Trauma configuration";
}

async function readRawMemoryContentMarkdown(
  config: ResolvedTraumaConfig,
  memoryId: string,
): Promise<string | null> {
  try {
    const resolvedPath = resolveMemoryContentPath(config, memoryId);
    return await readFile(resolvedPath.absolutePath, "utf8");
  } catch (error) {
    if (error instanceof MemoryContentStoreError) {
      return null;
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

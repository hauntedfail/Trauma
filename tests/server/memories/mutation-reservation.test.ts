import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { DurableMemoryBackupQueue } from "../../../src/server/backup";
import type { ResolvedTraumaConfig } from "../../../src/server/config";
import type {
  TranslationJobRecord,
  TranslationRepository,
} from "../../../src/server/db/repositories";
import { writeFlashbackMetadataExport } from "../../../src/server/flashbacks/export";
import {
  MemoryDeletionReservedError,
  withMemoryArtifactMutation,
  withMemoryDeletionReservation,
} from "../../../src/server/memories/mutation-reservation";
import { createPsychiatristThread } from "../../../src/server/psychiatrist/thread-store";
import { appendPsychiatristStreamEvent } from "../../../src/server/psychiatrist/stream-store";
import type { PsychiatristThreadManifest } from "../../../src/server/psychiatrist/types";
import { commitTranslatedContent } from "../../../src/server/translation/stitching";

const memoryId = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef991";

describe("memory artifact mutation reservations", () => {
  it("waits for an admitted writer and rejects writers admitted after deletion", async () => {
    const order: string[] = [];
    const writerEntered = deferred<void>();
    const releaseWriter = deferred<void>();

    const writer = withMemoryArtifactMutation(
      { memoryId, storePath: "/tmp/trauma-mutation-reservation" },
      async (reservation) => {
        reservation.assertWritable();
        order.push("writer-start");
        writerEntered.resolve();
        await releaseWriter.promise;
        reservation.assertWritable();
        order.push("writer-end");
      },
    );
    await writerEntered.promise;

    const deletion = withMemoryDeletionReservation(
      { memoryId, storePath: "/tmp/trauma-mutation-reservation" },
      async (reservation) => {
        reservation.assertExclusive();
        order.push("delete");
      },
    );

    await expect(withMemoryArtifactMutation(
      { memoryId, storePath: "/tmp/trauma-mutation-reservation" },
      async () => undefined,
    )).rejects.toBeInstanceOf(MemoryDeletionReservedError);
    expect(order).toEqual(["writer-start"]);

    releaseWriter.resolve();
    await Promise.all([writer, deletion]);
    expect(order).toEqual(["writer-start", "writer-end", "delete"]);
  });

  it("keeps nested artifact writes admitted while deletion waits for their owner", async () => {
    const outerEntered = deferred<void>();
    const continueOuter = deferred<void>();
    const order: string[] = [];

    const outer = withMemoryArtifactMutation(
      { memoryId, storePath: "/tmp/trauma-mutation-reservation-reentrant" },
      async () => {
        order.push("outer-start");
        outerEntered.resolve();
        await continueOuter.promise;
        await withMemoryArtifactMutation(
          { memoryId, storePath: "/tmp/trauma-mutation-reservation-reentrant" },
          async (reservation) => {
            reservation.assertWritable();
            order.push("nested");
          },
        );
        order.push("outer-end");
      },
    );
    await outerEntered.promise;

    const deletion = withMemoryDeletionReservation(
      { memoryId, storePath: "/tmp/trauma-mutation-reservation-reentrant" },
      async () => {
        order.push("delete");
      },
    );
    continueOuter.resolve();

    await Promise.all([outer, deletion]);
    expect(order).toEqual(["outer-start", "nested", "outer-end", "delete"]);
  });

  it("prevents every memory-local writer from recreating a reserved directory", async () => {
    const storePath = await mkdtemp(join(tmpdir(), "trauma-mutation-writers-"));
    const deletionEntered = deferred<void>();
    const releaseDeletion = deferred<void>();
    const deletion = withMemoryDeletionReservation(
      { memoryId, storePath },
      async () => {
        deletionEntered.resolve();
        await releaseDeletion.promise;
      },
    );
    await deletionEntered.promise;

    const backupQueue: DurableMemoryBackupQueue = {
      enqueue: async () => ({ backupStatus: "queued" }),
      persistIntent: async () => ({ backupStatus: "pending" }),
    };
    try {
      await expect(writeFlashbackMetadataExport({
        config: { storePath },
        flashbacks: [],
        memoryId,
      })).rejects.toBeInstanceOf(MemoryDeletionReservedError);
      await expect(createPsychiatristThread({
        config: { storePath },
        manifest: {
          memoryId,
          threadId: "019e8a00-0000-7000-8000-000000000001",
        } as PsychiatristThreadManifest,
      })).rejects.toBeInstanceOf(MemoryDeletionReservedError);
      await expect(appendPsychiatristStreamEvent({
        config: { storePath },
        event: {
          data: { text: "working" },
          memoryId,
          threadId: "019e8a00-0000-7000-8000-000000000001",
          turnId: "019e8a00-0000-7000-8000-000000000002",
          type: "psychiatrist.process.delta",
        },
      })).rejects.toBeInstanceOf(MemoryDeletionReservedError);
      await expect(commitTranslatedContent({
        backupQueue,
        chunks: [],
        config: { storePath } as ResolvedTraumaConfig,
        job: { memoryId } as TranslationJobRecord,
        repository: {} as TranslationRepository,
      })).rejects.toBeInstanceOf(MemoryDeletionReservedError);
      await expect(access(join(storePath, "memories", memoryId)))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      releaseDeletion.resolve();
      await deletion;
      await rm(storePath, { recursive: true, force: true });
    }
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DurableMemoryBackupQueue } from "../../../src/server/backup";
import type { ResolvedTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";
import { createMemoryContentFixture } from "../../../src/server/store";
import {
  interruptRunningTranslationJobTurn,
  runTranslationJob,
  startTranslationJob,
} from "../../../src/server/translation/runner";
import {
  resolveTranslatedMemoryContentPath,
  resolveTranslatedMemoryProjectionPath,
} from "../../../src/server/translation/paths";
import { translationEventBus } from "../../../src/server/translation/events";
import type {
  RawCodexChunkOutput,
  TranslationChunk,
} from "../../../src/server/translation/types";
import {
  CodexAppServerError,
  type TranslateChunkInput,
  type TranslationClient,
} from "../../../src/server/translation/codex-app-server";
import {
  CODEX_RUNTIME_ISOLATION_ENV,
  LEGACY_CODEX_RUNTIME_ISOLATION_ENV,
} from "../../../src/server/codex/runtime-isolation";

const tempRoots: string[] = [];
const now = new Date("2026-05-21T00:00:00.000Z");
const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f905";

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("translation runner", () => {
  it("does not reserve a production translation job without runtime isolation", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const previousShared = process.env[CODEX_RUNTIME_ISOLATION_ENV];
    const previousLegacy = process.env[LEGACY_CODEX_RUNTIME_ISOLATION_ENV];
    delete process.env[CODEX_RUNTIME_ISOLATION_ENV];
    delete process.env[LEGACY_CODEX_RUNTIME_ISOLATION_ENV];
    const jobId = "019e3906-0000-7000-8000-000000000099";

    try {
      await expect(
        startTranslationJob({
          config,
          generateJobId: () => jobId,
          memoryId,
          now,
          schedule: () => {
            throw new Error("must not schedule an unisolated turn");
          },
        }),
      ).rejects.toMatchObject({ code: "runtime_isolation_required" });

      const connection = initializeDatabase(config);
      try {
        await expect(
          connection.repositories.translations.getTranslationJob(jobId),
        ).resolves.toBeNull();
      } finally {
        connection.close();
      }
    } finally {
      restoreEnvironment(CODEX_RUNTIME_ISOLATION_ENV, previousShared);
      restoreEnvironment(LEGACY_CODEX_RUNTIME_ISOLATION_ENV, previousLegacy);
    }
  });

  it("starts a job through the atomic job-and-chunks repository operation", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const client = new FakeTranslationClient();
    let atomicCreateCalls = 0;

    await expect(
      startTranslationJob({
        client,
        config,
        generateJobId: () => "019e3906-0000-7000-8000-000000000021",
        memoryId,
        now,
        openConnection: (connectionConfig) => {
          const connection = initializeDatabase(connectionConfig);
          const translations = connection.repositories.translations;
          return {
            ...connection,
            repositories: {
              ...connection.repositories,
              translations: {
                ...translations,
                createTranslationJob: async () => {
                  throw new Error("non-atomic job creation must not be used");
                },
                createTranslationJobWithChunks: async (...args) => {
                  atomicCreateCalls += 1;
                  return translations.createTranslationJobWithChunks(...args);
                },
                insertTranslationChunks: async () => {
                  throw new Error("separate chunk insertion must not be used");
                },
              },
            },
          };
        },
        schedule: () => undefined,
      }),
    ).resolves.toMatchObject({ status: "started" });
    expect(atomicCreateCalls).toBe(1);
  });

  it("starts a job, translates chunks, commits output, and reuses current output", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const client = new FakeTranslationClient();
    const enqueued: unknown[] = [];
    const backupQueue: DurableMemoryBackupQueue = {
      persistIntent: async () => ({ backupStatus: "pending" }),
      enqueue: async (input) => {
        enqueued.push(input);
        return { backupStatus: "queued" };
      },
    };

    const started = await startTranslationJob({
      backupQueue,
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000001",
      memoryId,
      model: "gpt-5.5",
      now,
      reasoningEffort: "high",
      schedule: () => undefined,
    });
    expect(started).toMatchObject({
      status: "started",
      lang_code: "ja-JP",
      event_url: "/api/translation-jobs/019e3906-0000-7000-8000-000000000001/events",
    });

    await runTranslationJob(started.job_id, {
      backupQueue,
      client,
      config,
    });

    expect(client.inputs).toHaveLength(1);
    expect(client.inputs[0]).toMatchObject({
      model: "gpt-5.5",
      reasoningEffort: "high",
    });
    expect(client.inputs[0]?.prompt).toContain("\"segments\"");
    expect(client.inputs[0]?.prompt).not.toContain("\"translated_markdown\"");
    const connection = initializeDatabase(config);
    try {
      const job = await connection.repositories.translations.getTranslationJob(
        started.job_id,
      );
      expect(job).toMatchObject({
        model: "gpt-5.5",
        reasoningEffort: "high",
      });
      expect(job?.outputHash).toMatch(/^sha256:/);
      await expect(
        connection.repositories.translations.listCurrentProjectionSpans({
          langCode: "ja-JP",
          memoryId,
          outputHash: job?.outputHash ?? "",
          sourceHash: job?.sourceHash ?? "",
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          segmentId: "s000001",
          translatedMarkdownStart: 2,
        }),
        expect.objectContaining({
          segmentId: "s000002",
        }),
      ]);
    } finally {
      connection.close();
    }

    expect(enqueued).toEqual([
      {
        contentPaths: [
          `memories/${memoryId}/ja-JP/CONTENT.md`,
          `memories/${memoryId}/ja-JP/TRANSLATION_MAP.json`,
        ],
        memoryId,
        reason: "translation_update",
      },
    ]);
    const projectionPath = resolveTranslatedMemoryProjectionPath({
      config,
      langCode: "ja-JP",
      memoryId,
    });
    await expect(readFile(projectionPath.absolutePath, "utf8"))
      .resolves.toContain("\"version\": 1");

    await expect(
      startTranslationJob({
        backupQueue,
        client,
        config,
        memoryId,
        now,
        schedule: () => undefined,
      }),
    ).resolves.toMatchObject({
      status: "current",
      reader_url: `/memories/ja-JP/${memoryId}`,
    });
  });

  it("loads persisted chunk state once before translating a multi-chunk job", async () => {
    const config = await createConfig();
    await writeSourceContent(
      config,
      [
        "# Brilliant Source",
        ...Array.from({ length: 81 }, () => "Body."),
      ].join("\n\n"),
    );
    await createMemoryRow(config);
    const client = new FakeTranslationClient();
    const started = await startTranslationJob({
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000022",
      memoryId,
      now,
      schedule: () => undefined,
    });
    let chunkStateReads = 0;

    await runTranslationJob(started.job_id, {
      client,
      config,
      openConnection: (connectionConfig) => {
        const connection = initializeDatabase(connectionConfig);
        const translations = connection.repositories.translations;
        return {
          ...connection,
          repositories: {
            ...connection.repositories,
            translations: {
              ...translations,
              getTranslationChunks: async (...args) => {
                chunkStateReads += 1;
                return translations.getTranslationChunks(...args);
              },
            },
          },
        };
      },
    });

    expect(client.inputs).toHaveLength(2);
    expect(chunkStateReads).toBe(2);
  });

  it("rejects request languages that differ from the configured target", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const client = new FakeTranslationClient();

    await expect(
      startTranslationJob({
        client,
        config,
        generateJobId: () => "019e3906-0000-7000-8000-000000000020",
        langCode: "en-US",
        memoryId,
        now,
        schedule: () => undefined,
      }),
    ).rejects.toMatchObject({
      action: "open_settings",
      code: "translation_language_mismatch",
    });

    const connection = initializeDatabase(config);
    try {
      await expect(connection.repositories.settings.getSettings(now))
        .resolves.toMatchObject({
          translationTargetLanguage: "ja-JP",
        });
      await expect(
        connection.repositories.translations.getTranslationJob(
          "019e3906-0000-7000-8000-000000000020",
        ),
      ).resolves.toBeNull();
    } finally {
      connection.close();
    }
  });

  it("commits translated chunks with the source Markdown block shape", async () => {
    const config = await createConfig();
    await writeSourceContent(config, [
      "*Brilliant Source*",
      "",
      "---",
      "",
      "## Brilliant Source",
      "",
      "Body.",
    ].join("\n"));
    await createMemoryRow(config);
    const client = new FlatTranslationClient();

    const started = await startTranslationJob({
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000003",
      memoryId,
      now,
      schedule: () => undefined,
    });

    await runTranslationJob(started.job_id, { client, config });

    await expect(readFile(
      join(config.storePath, "memories", memoryId, "ja-JP", "CONTENT.md"),
      "utf8",
    )).resolves.toContain([
      "*華麗なソース*",
      "",
      "---",
      "",
      "## 華麗なソース",
      "",
      "本文。",
    ].join("\n"));
  });

  it("rejects source documents with no translatable blocks before creating a job", async () => {
    const config = await createConfig();
    await writeSourceContent(config, "");
    await createMemoryRow(config);
    const client = new FakeTranslationClient();

    await expect(
      startTranslationJob({
        client,
        config,
        generateJobId: () => "019e3906-0000-7000-8000-000000000009",
        memoryId,
        now,
        schedule: () => undefined,
      }),
    ).rejects.toMatchObject({
      code: "validation_failed",
    });

    const connection = initializeDatabase(config);
    try {
      await expect(
        connection.repositories.translations.getTranslationJob(
          "019e3906-0000-7000-8000-000000000009",
        ),
      ).resolves.toBeNull();
    } finally {
      connection.close();
    }
  });

  it("tracks active Codex turns so cancellation can interrupt app-server work", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const client = new InterruptibleTranslationClient();

    const started = await startTranslationJob({
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000002",
      memoryId,
      now,
      schedule: () => undefined,
    });
    const runPromise = runTranslationJob(started.job_id, {
      client,
      config,
    });

    await client.waitUntilTurnStarted();

    await expect(interruptRunningTranslationJobTurn(started.job_id))
      .resolves.toBe(true);
    expect(client.cancelCalls).toEqual([
      { threadId: "thread-active", turnId: "turn-active" },
    ]);

    client.completeTranslation();
    await runPromise;
  });

  it("preserves academic Markdown syntax while committing segment translations", async () => {
    const config = await createConfig();
    const fixture = await readFile(
      new URL("../../fixtures/translation/academic-paper-segments.md", import.meta.url),
      "utf8",
    );
    const filePath = join(config.storePath, "memories", memoryId, "CONTENT.md");
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, fixture, "utf8");
    await createMemoryRow(config);
    const client = new MarkerTranslationClient();

    const started = await startTranslationJob({
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000004",
      memoryId,
      now,
      schedule: () => undefined,
    });

    await runTranslationJob(started.job_id, { client, config });

    const output = await readFile(
      join(config.storePath, "memories", memoryId, "ja-JP", "CONTENT.md"),
      "utf8",
    );
    expect(output).toContain("url: \"https://example.com/brilliant\"");
    expect(output).toContain("[JA:s");
    expect(output).toContain("](https://example.com/reference \"Reference title\")");
    expect(output).toContain("`inlineCode`");
    expect(output).toContain("const preserved = \"code\";");
    expect(output).toContain("$p(y|x)$");
    expect(output).toContain("\\operatorname*{argmax}_y p(y|x)");
    expect(output).toContain("| --- | --- |");
    expect(output).toContain("[^1]:");
  });

  it("emits stale when the source changes after chunks complete but before commit", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const jobId = "019e3906-0000-7000-8000-000000000005";
    const events: string[] = [];
    const unsubscribe = translationEventBus.subscribe(jobId, (event) => {
      events.push(event.type);
    });
    const client = new SourceMutatingTranslationClient(async () => {
      await writeSourceContent(config, "# Brilliant Source\n\nChanged.");
    });

    try {
      const started = await startTranslationJob({
        client,
        config,
        generateJobId: () => jobId,
        memoryId,
        now,
        schedule: () => undefined,
      });

      await runTranslationJob(started.job_id, { client, config });
    } finally {
      unsubscribe();
    }

    const connection = initializeDatabase(config);
    try {
      await expect(
        connection.repositories.translations.getTranslationJob(jobId),
      ).resolves.toMatchObject({
        status: "stale",
        error: expect.objectContaining({
          code: "stale_source",
        }),
      });
    } finally {
      connection.close();
    }
    expect(events).toContain("translation.job.stale");
    expect(events).not.toContain("translation.job.completed");
  });

  it("honors cancellation requested after a chunk completes before stitching", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const jobId = "019e3906-0000-7000-8000-000000000006";
    const events: string[] = [];
    const unsubscribe = translationEventBus.subscribe(jobId, (event) => {
      events.push(event.type);
    });
    const client = new CancelAfterOutputTranslationClient(async () => {
      const connection = initializeDatabase(config);
      try {
        await connection.repositories.translations
          .requestRunningTranslationJobCancellation(jobId, new Date());
      } finally {
        connection.close();
      }
    });

    try {
      const started = await startTranslationJob({
        client,
        config,
        generateJobId: () => jobId,
        memoryId,
        now,
        schedule: () => undefined,
      });

      await runTranslationJob(started.job_id, { client, config });
    } finally {
      unsubscribe();
    }

    const connection = initializeDatabase(config);
    try {
      await expect(
        connection.repositories.translations.getTranslationJob(jobId),
      ).resolves.toMatchObject({
        status: "canceled",
      });
    } finally {
      connection.close();
    }
    expect(events).toContain("translation.job.canceled");
    expect(events).not.toContain("translation.job.stitching");
    expect(events).not.toContain("translation.job.completed");
  });

  it("finalizes a stalled in-flight chunk after the cancellation grace expires", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const jobId = "019e3906-0000-7000-8000-000000000016";
    const client = new GraceTimeoutTranslationClient();
    const started = await startTranslationJob({
      client,
      config,
      generateJobId: () => jobId,
      memoryId,
      now,
      schedule: () => undefined,
    });
    const runPromise = runTranslationJob(started.job_id, {
      cancelGraceMs: 5,
      client,
      config,
    });

    try {
      await client.waitUntilTurnStarted();
      const connection = initializeDatabase(config);
      try {
        await connection.repositories.translations
          .requestRunningTranslationJobCancellation(jobId, new Date());
      } finally {
        connection.close();
      }

      await waitForJobStatus(config, jobId, "canceled");
    } finally {
      client.completeTranslation();
      await runPromise;
    }
  });

  it("does not overwrite cancellation accepted before stitching transition", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const jobId = "019e3906-0000-7000-8000-000000000011";
    const events: string[] = [];
    const unsubscribe = translationEventBus.subscribe(jobId, (event) => {
      events.push(event.type);
    });
    let cancelRaceInjected = false;
    const client = new FakeTranslationClient();

    try {
      const started = await startTranslationJob({
        client,
        config,
        generateJobId: () => jobId,
        memoryId,
        now,
        schedule: () => undefined,
      });

      await runTranslationJob(started.job_id, {
        client,
        config,
        openConnection: (connectionConfig) => {
          const connection = initializeDatabase(connectionConfig);
          const translations = connection.repositories.translations;
          return {
            ...connection,
            repositories: {
              ...connection.repositories,
              translations: {
                ...translations,
                updateTranslationJobStatus: async (...args) => {
                  if (!cancelRaceInjected && args[1] === "stitching") {
                    cancelRaceInjected = true;
                    await translations.requestRunningTranslationJobCancellation(
                      jobId,
                      new Date(),
                    );
                  }
                  return translations.updateTranslationJobStatus(...args);
                },
                transitionTranslationJobStatus: async (...args) => {
                  if (
                    !cancelRaceInjected &&
                    args[1] === "running" &&
                    args[2] === "stitching"
                  ) {
                    cancelRaceInjected = true;
                    await translations.requestRunningTranslationJobCancellation(
                      jobId,
                      new Date(),
                    );
                  }
                  return translations.transitionTranslationJobStatus(...args);
                },
              },
            },
          };
        },
      });
    } finally {
      unsubscribe();
    }

    const connection = initializeDatabase(config);
    try {
      await expect(
        connection.repositories.translations.getTranslationJob(jobId),
      ).resolves.toMatchObject({
        status: "canceled",
      });
    } finally {
      connection.close();
    }
    const outputPath = resolveTranslatedMemoryContentPath({
      config,
      langCode: "ja-JP",
      memoryId,
    });
    await expect(readFile(outputPath.absolutePath, "utf8")).rejects.toThrow();
    expect(events).toContain("translation.job.canceled");
    expect(events).not.toContain("translation.job.stitching");
    expect(events).not.toContain("translation.job.completed");
  });

  it("does not overwrite cancellation accepted while terminalizing a failure", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const jobId = "019e3906-0000-7000-8000-000000000031";
    const events: string[] = [];
    const unsubscribe = translationEventBus.subscribe(jobId, (event) => {
      events.push(event.type);
    });
    const client = new DiagnosticFailingTranslationClient("diagnostic");
    let cancellationInjected = false;
    const injectCancellation = async (
      targetStatus: string,
      translations: ReturnType<typeof initializeDatabase>["repositories"]["translations"],
    ) => {
      if (!cancellationInjected && targetStatus === "failed") {
        cancellationInjected = true;
        await translations.requestRunningTranslationJobCancellation(
          jobId,
          new Date(),
        );
      }
    };

    try {
      const started = await startTranslationJob({
        client,
        config,
        generateJobId: () => jobId,
        memoryId,
        now,
        schedule: () => undefined,
      });
      await runTranslationJob(started.job_id, {
        client,
        config,
        openConnection: (connectionConfig) => {
          const connection = initializeDatabase(connectionConfig);
          const translations = connection.repositories.translations;
          return {
            ...connection,
            repositories: {
              ...connection.repositories,
              translations: {
                ...translations,
                updateTranslationJobStatus: async (...args) => {
                  await injectCancellation(args[1], translations);
                  return translations.updateTranslationJobStatus(...args);
                },
                transitionTranslationJobStatus: async (...args) => {
                  await injectCancellation(args[2], translations);
                  return translations.transitionTranslationJobStatus(...args);
                },
              },
            },
          };
        },
      });
    } finally {
      unsubscribe();
    }

    const connection = initializeDatabase(config);
    try {
      await expect(connection.repositories.translations.getTranslationJob(jobId))
        .resolves.toMatchObject({ status: "canceled" });
    } finally {
      connection.close();
    }
    expect(events).toContain("translation.job.canceled");
    expect(events).not.toContain("translation.job.failed");
  });

  it("does not overwrite cancellation accepted while terminalizing stale source", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const jobId = "019e3906-0000-7000-8000-000000000032";
    const events: string[] = [];
    const unsubscribe = translationEventBus.subscribe(jobId, (event) => {
      events.push(event.type);
    });
    const client = new FakeTranslationClient();
    let cancellationInjected = false;
    const injectCancellation = async (
      targetStatus: string,
      translations: ReturnType<typeof initializeDatabase>["repositories"]["translations"],
    ) => {
      if (!cancellationInjected && targetStatus === "stale") {
        cancellationInjected = true;
        await translations.requestRunningTranslationJobCancellation(
          jobId,
          new Date(),
        );
      }
    };

    try {
      const started = await startTranslationJob({
        client,
        config,
        generateJobId: () => jobId,
        memoryId,
        now,
        schedule: () => undefined,
      });
      await writeSourceContent(config, "# Brilliant Source\n\nChanged.");
      await runTranslationJob(started.job_id, {
        client,
        config,
        openConnection: (connectionConfig) => {
          const connection = initializeDatabase(connectionConfig);
          const translations = connection.repositories.translations;
          return {
            ...connection,
            repositories: {
              ...connection.repositories,
              translations: {
                ...translations,
                updateTranslationJobStatus: async (...args) => {
                  await injectCancellation(args[1], translations);
                  return translations.updateTranslationJobStatus(...args);
                },
                transitionTranslationJobStatus: async (...args) => {
                  await injectCancellation(args[2], translations);
                  return translations.transitionTranslationJobStatus(...args);
                },
              },
            },
          };
        },
      });
    } finally {
      unsubscribe();
    }

    const connection = initializeDatabase(config);
    try {
      await expect(connection.repositories.translations.getTranslationJob(jobId))
        .resolves.toMatchObject({ status: "canceled" });
    } finally {
      connection.close();
    }
    expect(events).toContain("translation.job.canceled");
    expect(events).not.toContain("translation.job.stale");
  });

  it("does not emit completion when the complete CAS loses a terminal race", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const jobId = "019e3906-0000-7000-8000-000000000033";
    const events: string[] = [];
    const unsubscribe = translationEventBus.subscribe(jobId, (event) => {
      events.push(event.type);
    });
    const client = new FakeTranslationClient();
    let terminalRaceInjected = false;
    const injectTerminalRace = async (
      targetStatus: string,
      translations: ReturnType<typeof initializeDatabase>["repositories"]["translations"],
    ) => {
      if (!terminalRaceInjected && targetStatus === "complete") {
        terminalRaceInjected = true;
        await translations.updateTranslationJobStatus(jobId, "canceled", {
          completedAt: new Date(),
          error: null,
          updatedAt: new Date(),
        });
      }
    };

    try {
      const started = await startTranslationJob({
        client,
        config,
        generateJobId: () => jobId,
        memoryId,
        now,
        schedule: () => undefined,
      });
      await runTranslationJob(started.job_id, {
        client,
        config,
        openConnection: (connectionConfig) => {
          const connection = initializeDatabase(connectionConfig);
          const translations = connection.repositories.translations;
          return {
            ...connection,
            repositories: {
              ...connection.repositories,
              translations: {
                ...translations,
                updateTranslationJobStatus: async (...args) => {
                  await injectTerminalRace(args[1], translations);
                  return translations.updateTranslationJobStatus(...args);
                },
                transitionTranslationJobStatus: async (...args) => {
                  await injectTerminalRace(args[2], translations);
                  return translations.transitionTranslationJobStatus(...args);
                },
              },
            },
          };
        },
      });
    } finally {
      unsubscribe();
    }

    const connection = initializeDatabase(config);
    try {
      await expect(connection.repositories.translations.getTranslationJob(jobId))
        .resolves.toMatchObject({ status: "canceled" });
    } finally {
      connection.close();
    }
    expect(events).not.toContain("translation.job.completed");
    expect(events).not.toContain("translation.job.failed");
  });

  it("does not retry a failed chunk after cancellation is requested", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const jobId = "019e3906-0000-7000-8000-000000000007";
    const client = new FailThenCancelTranslationClient(async () => {
      const connection = initializeDatabase(config);
      try {
        await connection.repositories.translations
          .requestRunningTranslationJobCancellation(jobId, new Date());
      } finally {
        connection.close();
      }
    });

    const started = await startTranslationJob({
      client,
      config,
      generateJobId: () => jobId,
      memoryId,
      now,
      schedule: () => undefined,
    });

    await runTranslationJob(started.job_id, { client, config });

    const connection = initializeDatabase(config);
    try {
      await expect(
        connection.repositories.translations.getTranslationJob(jobId),
      ).resolves.toMatchObject({
        status: "canceled",
      });
    } finally {
      connection.close();
    }
    expect(client.callCount).toBe(1);
  });

  it("persists a safe projection of Codex failures", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const secret = "/Users/alice/.codex/auth.json token=unique-secret";
    const client = new DiagnosticFailingTranslationClient(secret);
    const started = await startTranslationJob({
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000099",
      memoryId,
      now,
      schedule: () => undefined,
    });

    await runTranslationJob(started.job_id, { client, config });

    const connection = initializeDatabase(config);
    try {
      const job = await connection.repositories.translations.getTranslationJob(
        started.job_id,
      );
      expect(job).toMatchObject({
        status: "failed",
        error: {
          code: "app_server_protocol_error",
          message: "Codex app-server returned an invalid response.",
        },
      });
      expect(JSON.stringify(job)).not.toContain(secret);
    } finally {
      connection.close();
    }
  });

  it("feeds validation diagnostics into the next chunk retry prompt", async () => {
    const config = await createConfig();
    await writeSourceContent(
      config,
      "# Brilliant Source\n\nRead [docs](https://example.com/docs) and `AGENTS.md`.",
    );
    await createMemoryRow(config);
    const client = new ValidationRetryTranslationClient();

    const started = await startTranslationJob({
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000014",
      memoryId,
      now,
      schedule: () => undefined,
    });

    await runTranslationJob(started.job_id, { client, config });

    expect(client.inputs).toHaveLength(2);
    expect(client.inputs[0]?.prompt).not.toContain("Retry correction:");
    expect(client.inputs[1]?.prompt).toContain("Retry correction:");
    expect(client.inputs[1]?.prompt).toContain("markdown_structure");
    expect(client.inputs[1]?.prompt).toContain("AGENTS.md");
    expect(client.inputs[1]?.prompt).toContain("agents.md");
    expect(client.inputs[1]?.prompt).not.toContain("RAW_FAILED_TRANSLATED_OUTPUT");

    const connection = initializeDatabase(config);
    try {
      await expect(
        connection.repositories.translations.getTranslationJob(started.job_id),
      ).resolves.toMatchObject({ status: "complete" });
    } finally {
      connection.close();
    }
  });

  it("retries and commits a code-heavy chunk after structural validation feedback", async () => {
    const config = await createConfig();
    await writeSourceContent(
      config,
      [
        "# Skill MCP Setup",
        "",
        "| Item | Command | Notes |",
        "| --- | --- | --- |",
        "| Agent file | `AGENTS.md` | Keep `$HOME/.codex` unchanged. |",
        "| Server | `mcp-server` | Run `bun --bun x vitest run`. |",
        "",
        "- Keep inline atoms such as `tool_search`, `context7`, and `node_repl` exact.",
        "- Do not translate shell variables like `$HOME` when they appear as code.",
        "",
        "```json",
        "{",
        "  \"server\": \"context7\",",
        "  \"transport\": \"stdio\"",
        "}",
        "```",
        "",
        "```yaml",
        "---",
        "name: reader-translate",
        "tools:",
        "  - mcp",
        "---",
        "```",
        "",
        "Use `AGENTS.md` before editing prompt validation rules.",
      ].join("\n"),
    );
    await createMemoryRow(config);
    const client = new CodeHeavyValidationRetryTranslationClient();

    const started = await startTranslationJob({
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000015",
      memoryId,
      now,
      schedule: () => undefined,
    });

    await runTranslationJob(started.job_id, { client, config });

    expect(client.inputs).toHaveLength(2);
    expect(client.inputs[0]?.prompt).not.toContain("Retry correction:");
    expect(client.inputs[1]?.prompt).toContain("Retry correction:");
    expect(client.inputs[1]?.prompt).toContain("markdown_structure");
    expect(client.inputs[1]?.prompt).toContain("AGENTS.md");
    expect(client.inputs[1]?.prompt).toContain("agents.md");
    expect(client.inputs[1]?.prompt).not.toContain("RAW_FAILED_TRANSLATED_OUTPUT");

    const output = await readFile(
      join(config.storePath, "memories", memoryId, "ja-JP", "CONTENT.md"),
      "utf8",
    );
    expect(output).toContain("| 翻訳済み Item | 翻訳済み Command | 翻訳済み Notes |");
    expect(output).toContain("| 翻訳済み Agent file | `AGENTS.md` |");
    expect(output).toContain("`$HOME/.codex`");
    expect(output).toContain("`bun --bun x vitest run`");
    expect(output).toContain("```json\n{\n  \"server\": \"context7\"");
    expect(output).toContain("```yaml\n---\nname: reader-translate");

    const connection = initializeDatabase(config);
    try {
      await expect(
        connection.repositories.translations.getTranslationJob(started.job_id),
      ).resolves.toMatchObject({ status: "complete" });
    } finally {
      connection.close();
    }
  });

  it("feeds empty segment diagnostics into the next retry prompt", async () => {
    const config = await createConfig();
    await writeSourceContent(
      config,
      "# Brilliant Source\n\nTranslate this paragraph without dropping any prose.",
    );
    await createMemoryRow(config);
    const client = new EmptySegmentRetryTranslationClient();

    const started = await startTranslationJob({
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000016",
      memoryId,
      now,
      schedule: () => undefined,
    });

    await runTranslationJob(started.job_id, { client, config });

    expect(client.inputs).toHaveLength(2);
    expect(client.inputs[1]?.prompt).toContain("Retry correction:");
    expect(client.inputs[1]?.prompt).toContain("segment_schema");
    expect(client.inputs[1]?.prompt).toContain("s000001");
    expect(client.inputs[1]?.prompt).toContain("translated_text is empty");

    const connection = initializeDatabase(config);
    try {
      await expect(
        connection.repositories.translations.getTranslationJob(started.job_id),
      ).resolves.toMatchObject({ status: "complete" });
    } finally {
      connection.close();
    }
  });

  it("closes a translation client when the scheduled run owns it", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const client = new CloseTrackingTranslationClient();

    const started = await startTranslationJob({
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000008",
      memoryId,
      now,
      schedule: () => undefined,
    });

    await runTranslationJob(started.job_id, {
      client,
      closeClientAfterRun: true,
      config,
    });

    expect(client.closeCalls).toBe(1);
  });

  it("closes an internally created translation client when start fails before scheduling", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const client = new ProbeFailingCloseTrackingTranslationClient();

    await expect(
      startTranslationJob({
        config,
        createClient: () => client,
        generateJobId: () => "019e3906-0000-7000-8000-000000000009",
        memoryId,
        now,
        schedule: () => {
          throw new Error("should not schedule after probe failure");
        },
      }),
    ).rejects.toThrow("probe failed");

    expect(client.closeCalls).toBe(1);
  });

  it("keeps a committed translation complete when backup enqueue fails", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const client = new FakeTranslationClient();
    const backupQueue: DurableMemoryBackupQueue = {
      persistIntent: async () => ({ backupStatus: "pending" }),
      enqueue: async () => {
        throw new Error("backup queue is unavailable");
      },
    };

    const started = await startTranslationJob({
      backupQueue,
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000010",
      memoryId,
      now,
      schedule: () => undefined,
    });

    await runTranslationJob(started.job_id, { backupQueue, client, config });

    const connection = initializeDatabase(config);
    try {
      await expect(
        connection.repositories.translations.getTranslationJob(started.job_id),
      ).resolves.toMatchObject({
        status: "complete",
        error: null,
      });
    } finally {
      connection.close();
    }
  });

  it("requeues persisted pending jobs when translation start sees them active", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const client = new FakeTranslationClient();
    const started = await startTranslationJob({
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000011",
      memoryId,
      now,
      schedule: () => undefined,
    });
    const scheduled: string[] = [];

    await expect(
      startTranslationJob({
        client,
        config,
        memoryId,
        now,
        schedule: (jobId) => scheduled.push(jobId),
      }),
    ).resolves.toMatchObject({
      status: "active",
      job_id: started.job_id,
      job_status: "pending",
    });
    expect(scheduled).toEqual([started.job_id]);
  });

  it("returns a cancellation conflict while an active job cancellation is finalizing", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const client = new FakeTranslationClient();
    const started = await startTranslationJob({
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000017",
      memoryId,
      now,
      schedule: () => undefined,
    });
    const connection = initializeDatabase(config);
    try {
      await connection.repositories.translations.updateTranslationJobStatus(
        started.job_id,
        "cancel_requested",
        { updatedAt: now },
      );
    } finally {
      connection.close();
    }

    await expect(
      startTranslationJob({
        client,
        config,
        memoryId,
        now,
        schedule: () => undefined,
      }),
    ).rejects.toMatchObject({
      code: "cancellation_conflict",
    });
  });

  it("returns the active job when creation loses the active-job uniqueness race", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const client = new CloseTrackingTranslationClient();
    const active = await startTranslationJob({
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000014",
      memoryId,
      now,
      schedule: () => undefined,
    });
    let findActiveCalls = 0;

    await expect(
      startTranslationJob({
        client,
        config,
        generateJobId: () => "019e3906-0000-7000-8000-000000000015",
        memoryId,
        now,
        openConnection: (connectionConfig) => {
          const connection = initializeDatabase(connectionConfig);
          return {
            ...connection,
            repositories: {
              ...connection.repositories,
              translations: {
                ...connection.repositories.translations,
                findActiveTranslationJob: async (...args) => {
                  findActiveCalls += 1;
                  return findActiveCalls === 1
                    ? null
                    : connection.repositories.translations.findActiveTranslationJob(
                      ...args,
                    );
                },
                createTranslationJobWithChunks: async () => {
                  throw new Error("UNIQUE constraint failed: translation_jobs");
                },
              },
            },
          };
        },
        schedule: () => undefined,
      }),
    ).resolves.toMatchObject({
      status: "active",
      job_id: active.job_id,
    });
  });

  it("returns a cancellation conflict when uniqueness fallback finds a cancel-requested job", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const client = new CloseTrackingTranslationClient();
    const active = await startTranslationJob({
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000018",
      memoryId,
      now,
      schedule: () => undefined,
    });
    const connection = initializeDatabase(config);
    try {
      await connection.repositories.translations.updateTranslationJobStatus(
        active.job_id,
        "cancel_requested",
        { updatedAt: now },
      );
    } finally {
      connection.close();
    }
    let findActiveCalls = 0;

    await expect(
      startTranslationJob({
        client,
        config,
        generateJobId: () => "019e3906-0000-7000-8000-000000000019",
        memoryId,
        now,
        openConnection: (connectionConfig) => {
          const connection = initializeDatabase(connectionConfig);
          return {
            ...connection,
            repositories: {
              ...connection.repositories,
              translations: {
                ...connection.repositories.translations,
                findActiveTranslationJob: async (...args) => {
                  findActiveCalls += 1;
                  return findActiveCalls === 1
                    ? null
                    : connection.repositories.translations.findActiveTranslationJob(
                      ...args,
                    );
                },
                createTranslationJobWithChunks: async () => {
                  throw new Error("UNIQUE constraint failed: translation_jobs");
                },
              },
            },
          };
        },
        schedule: () => undefined,
      }),
    ).rejects.toMatchObject({
      code: "cancellation_conflict",
    });
  });

  it("recovers cancel-requested jobs by marking them canceled", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const client = new FakeTranslationClient();
    const started = await startTranslationJob({
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000012",
      memoryId,
      now,
      schedule: () => undefined,
    });
    const connection = initializeDatabase(config);
    try {
      await connection.repositories.translations.updateTranslationJobStatus(
        started.job_id,
        "cancel_requested",
        { updatedAt: now },
      );
    } finally {
      connection.close();
    }

    await runTranslationJob(started.job_id, { client, config });

    const verifyConnection = initializeDatabase(config);
    try {
      await expect(
        verifyConnection.repositories.translations.getTranslationJob(started.job_id),
      ).resolves.toMatchObject({ status: "canceled" });
    } finally {
      verifyConnection.close();
    }
  });

  it("recovers finalizing jobs instead of leaving them active forever", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const client = new FakeTranslationClient();
    const started = await startTranslationJob({
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000013",
      memoryId,
      now,
      schedule: () => undefined,
    });
    const connection = initializeDatabase(config);
    try {
      await connection.repositories.translations.updateTranslationJobStatus(
        started.job_id,
        "stitching",
        { updatedAt: now },
      );
    } finally {
      connection.close();
    }

    await runTranslationJob(started.job_id, { client, config });

    const verifyConnection = initializeDatabase(config);
    try {
      await expect(
        verifyConnection.repositories.translations.getTranslationJob(started.job_id),
      ).resolves.toMatchObject({ status: "complete" });
    } finally {
      verifyConnection.close();
    }
  });

  it("resumes same-version completed chunks without translating them twice", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const client = new FakeTranslationClient();
    const persistedIntents: unknown[] = [];
    const enqueuedBackups: unknown[] = [];
    const backupQueue: DurableMemoryBackupQueue = {
      persistIntent: async (input) => {
        persistedIntents.push(input);
        return { backupStatus: "pending" };
      },
      enqueue: async (input) => {
        enqueuedBackups.push(input);
        return { backupStatus: "queued" };
      },
    };
    const started = await startTranslationJob({
      backupQueue,
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000024",
      memoryId,
      now,
      schedule: () => undefined,
    });
    let blockStitchingOnce = true;

    await runTranslationJob(started.job_id, {
      backupQueue,
      client,
      config,
      openConnection: (connectionConfig) => {
        const connection = initializeDatabase(connectionConfig);
        const translations = connection.repositories.translations;
        return {
          ...connection,
          repositories: {
            ...connection.repositories,
            translations: {
              ...translations,
              transitionTranslationJobStatus: async (...args) => {
                if (
                  blockStitchingOnce &&
                  args[1] === "running" &&
                  args[2] === "stitching"
                ) {
                  blockStitchingOnce = false;
                  return false;
                }
                return translations.transitionTranslationJobStatus(...args);
              },
            },
          },
        };
      },
    });

    expect(client.inputs).toHaveLength(1);
    const interruptedConnection = initializeDatabase(config);
    try {
      await expect(
        interruptedConnection.repositories.translations.getTranslationJob(started.job_id),
      ).resolves.toMatchObject({ status: "running" });
      await expect(
        interruptedConnection.repositories.translations.getTranslationChunks(started.job_id),
      ).resolves.toEqual([
        expect.objectContaining({ chunkIndex: 0, status: "complete" }),
      ]);
    } finally {
      interruptedConnection.close();
    }

    await runTranslationJob(started.job_id, { backupQueue, client, config });

    expect(client.inputs).toHaveLength(1);
    expect(persistedIntents).toHaveLength(1);
    expect(enqueuedBackups).toHaveLength(1);
    const outputPath = resolveTranslatedMemoryContentPath({
      config,
      langCode: "ja-JP",
      memoryId,
    });
    await expect(readFile(outputPath.absolutePath, "utf8"))
      .resolves.toContain("華麗なソース");
    const completedConnection = initializeDatabase(config);
    try {
      await expect(
        completedConnection.repositories.translations.getTranslationJob(started.job_id),
      ).resolves.toMatchObject({ status: "complete" });
    } finally {
      completedConnection.close();
    }
  });

  it.each([
    {
      mismatch: "prompt policy version",
      mutation: "update translation_jobs set prompt_policy_version = 'brilliant-old'",
    },
    {
      mismatch: "chunker version",
      mutation: "update translation_jobs set chunker_version = 'chunker-old'",
    },
    {
      mismatch: "runtime chunk count",
      mutation: "update translation_jobs set chunk_count = 2",
    },
    {
      mismatch: "persisted chunk count",
      mutation: "delete from translation_chunks",
    },
    {
      mismatch: "chunk index manifest",
      mutation: "update translation_chunks set chunk_index = 1",
    },
    {
      mismatch: "block id manifest",
      mutation: "update translation_chunks set block_ids_json = '[\"changed-block\"]'",
    },
    {
      mismatch: "source chunk hash",
      mutation: "update translation_chunks set source_chunk_hash = 'sha256:changed-chunk'",
    },
  ])("terminalizes a resume with incompatible $mismatch and allows a fresh job", async ({ mutation }) => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const client = new FakeTranslationClient();
    const backupCalls: unknown[] = [];
    const backupQueue: DurableMemoryBackupQueue = {
      persistIntent: async (input) => {
        backupCalls.push(input);
        return { backupStatus: "pending" };
      },
      enqueue: async (input) => {
        backupCalls.push(input);
        return { backupStatus: "queued" };
      },
    };
    const started = await startTranslationJob({
      backupQueue,
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000025",
      memoryId,
      now,
      schedule: () => undefined,
    });
    const mutationConnection = initializeDatabase(config);
    try {
      mutationConnection.sqlite.run(`${mutation} where job_id = '${started.job_id}'`);
    } finally {
      mutationConnection.close();
    }

    await runTranslationJob(started.job_id, { backupQueue, client, config });

    expect(client.inputs).toEqual([]);
    expect(backupCalls).toEqual([]);
    const outputPath = resolveTranslatedMemoryContentPath({
      config,
      langCode: "ja-JP",
      memoryId,
    });
    await expect(readFile(outputPath.absolutePath, "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    const failedConnection = initializeDatabase(config);
    try {
      await expect(
        failedConnection.repositories.translations.getTranslationJob(started.job_id),
      ).resolves.toMatchObject({
        error: {
          action: "start_fresh_translation",
          code: "translation_unavailable",
          message: "Translation job is incompatible with the current translation runtime.",
        },
        status: "failed",
      });
    } finally {
      failedConnection.close();
    }

    await expect(startTranslationJob({
      backupQueue,
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000026",
      memoryId,
      now,
      schedule: () => undefined,
    })).resolves.toMatchObject({
      job_id: "019e3906-0000-7000-8000-000000000026",
      status: "started",
    });
  });

  it("replays a committing job after an orphan output write and backs up the completed projection", async () => {
    const config = await createConfig();
    await writeSourceContent(config);
    await createMemoryRow(config);
    const client = new FakeTranslationClient();
    const persistedIntents: unknown[] = [];
    const enqueuedBackups: unknown[] = [];
    const backupQueue: DurableMemoryBackupQueue = {
      persistIntent: async (input) => {
        persistedIntents.push(input);
        return { backupStatus: "pending" };
      },
      enqueue: async (input) => {
        enqueuedBackups.push(input);
        return { backupStatus: "queued" };
      },
    };
    const started = await startTranslationJob({
      backupQueue,
      client,
      config,
      generateJobId: () => "019e3906-0000-7000-8000-000000000023",
      memoryId,
      now,
      schedule: () => undefined,
    });
    const outputPath = resolveTranslatedMemoryContentPath({
      config,
      langCode: "ja-JP",
      memoryId,
    });
    const projectionPath = resolveTranslatedMemoryProjectionPath({
      config,
      langCode: "ja-JP",
      memoryId,
    });
    const connection = initializeDatabase(config);
    try {
      await connection.repositories.translations.updateTranslationJobStatus(
        started.job_id,
        "committing",
        { updatedAt: now },
      );
    } finally {
      connection.close();
    }
    await mkdir(dirname(outputPath.absolutePath), { recursive: true });
    await writeFile(outputPath.absolutePath, "# Orphan output\n", "utf8");

    const scheduledJobIds: string[] = [];
    await expect(startTranslationJob({
      backupQueue,
      client,
      config,
      memoryId,
      now,
      schedule: (jobId) => {
        scheduledJobIds.push(jobId);
      },
    })).resolves.toMatchObject({
      status: "active",
      job_id: started.job_id,
      job_status: "committing",
    });
    expect(scheduledJobIds).toEqual([started.job_id]);

    await runTranslationJob(started.job_id, { backupQueue, client, config });

    const expectedBackup = {
      contentPaths: [outputPath.relativePath, projectionPath.relativePath],
      memoryId,
      reason: "translation_update",
    };
    expect(persistedIntents).toEqual([expectedBackup]);
    expect(enqueuedBackups).toEqual([expectedBackup]);
    await expect(readFile(outputPath.absolutePath, "utf8"))
      .resolves.toContain("華麗なソース");
    await expect(readFile(outputPath.absolutePath, "utf8"))
      .resolves.not.toContain("Orphan output");
    await expect(readFile(projectionPath.absolutePath, "utf8"))
      .resolves.toContain(`"jobId": "${started.job_id}"`);
    const verifyConnection = initializeDatabase(config);
    try {
      await expect(
        verifyConnection.repositories.translations.getTranslationJob(started.job_id),
      ).resolves.toMatchObject({
        status: "complete",
        outputPath: outputPath.relativePath,
      });
    } finally {
      verifyConnection.close();
    }
  });
});

class FakeTranslationClient implements TranslationClient {
  readonly inputs: TranslateChunkInput[] = [];

  async probe(): Promise<void> {}

  async translateChunk(input: TranslateChunkInput): Promise<RawCodexChunkOutput> {
    this.inputs.push(input);
    return {
      chunk_index: input.chunk.chunkIndex,
      segments: input.chunk.segments.map((segment) => ({
        id: segment.id,
        translated_text: segment.text.replaceAll(
          "Brilliant Source",
          "華麗なソース",
        ).replaceAll("Body.", "本文。"),
      })),
      warnings: [],
    };
  }
}

class FlatTranslationClient implements TranslationClient {
  async probe(): Promise<void> {}

  async translateChunk(input: {
    chunk: TranslationChunk;
  }): Promise<RawCodexChunkOutput> {
    return {
      chunk_index: input.chunk.chunkIndex,
      segments: input.chunk.segments.map((segment) => ({
        id: segment.id,
        translated_text: segment.text === "Body."
          ? "本文。"
          : "華麗なソース",
      })),
      warnings: [],
    };
  }
}

class InterruptibleTranslationClient implements TranslationClient {
  readonly cancelCalls: Array<{ threadId: string; turnId: string }> = [];
  private readonly translationCanFinish: Promise<void>;
  private readonly turnStarted: Promise<void>;
  private resolveTranslation: () => void = () => undefined;
  private resolveTurnStarted: () => void = () => undefined;

  constructor() {
    this.turnStarted = new Promise((resolve) => {
      this.resolveTurnStarted = resolve;
    });
    this.translationCanFinish = new Promise((resolve) => {
      this.resolveTranslation = resolve;
    });
  }

  async probe(): Promise<void> {}

  async cancelTurn(input: { threadId: string; turnId: string }): Promise<void> {
    this.cancelCalls.push(input);
  }

  async translateChunk(input: TranslateChunkInput): Promise<RawCodexChunkOutput> {
    input.onEvent?.({ type: "thread.started", threadId: "thread-active" });
    input.onEvent?.({ type: "turn.started", turnId: "turn-active" });
    this.resolveTurnStarted();
    await this.translationCanFinish;
    return {
      chunk_index: input.chunk.chunkIndex,
      segments: input.chunk.segments.map((segment) => ({
        id: segment.id,
        translated_text: segment.text.replaceAll(
          "Brilliant Source",
          "割り込み可能な翻訳見出し",
        ).replaceAll("Body.", "割り込み可能な翻訳本文。"),
      })),
      warnings: [],
    };
  }

  completeTranslation(): void {
    this.resolveTranslation();
  }

  waitUntilTurnStarted(): Promise<void> {
    return this.turnStarted;
  }
}

class GraceTimeoutTranslationClient implements TranslationClient {
  private readonly translationCanFinish: Promise<void>;
  private readonly turnStarted: Promise<void>;
  private resolveTranslation: () => void = () => undefined;
  private resolveTurnStarted: () => void = () => undefined;

  constructor() {
    this.turnStarted = new Promise((resolve) => {
      this.resolveTurnStarted = resolve;
    });
    this.translationCanFinish = new Promise((resolve) => {
      this.resolveTranslation = resolve;
    });
  }

  async probe(): Promise<void> {}

  async translateChunk(input: TranslateChunkInput): Promise<RawCodexChunkOutput> {
    input.onEvent?.({ type: "thread.started", threadId: "thread-grace" });
    input.onEvent?.({ type: "turn.started", turnId: "turn-grace" });
    this.resolveTurnStarted();
    await this.translationCanFinish;
    return {
      chunk_index: input.chunk.chunkIndex,
      segments: input.chunk.segments.map((segment) => ({
        id: segment.id,
        translated_text: segment.text.replaceAll(
          "Brilliant Source",
          "猶予後の翻訳見出し",
        ).replaceAll("Body.", "猶予後の翻訳本文。"),
      })),
      warnings: [],
    };
  }

  completeTranslation(): void {
    this.resolveTranslation();
  }

  waitUntilTurnStarted(): Promise<void> {
    return this.turnStarted;
  }
}

class MarkerTranslationClient implements TranslationClient {
  async probe(): Promise<void> {}

  async translateChunk(input: TranslateChunkInput): Promise<RawCodexChunkOutput> {
    return {
      chunk_index: input.chunk.chunkIndex,
      segments: input.chunk.segments.map((segment) => ({
        id: segment.id,
        translated_text: `JA:${segment.id}`,
      })),
      warnings: [],
    };
  }
}

class SourceMutatingTranslationClient implements TranslationClient {
  private hasMutated = false;

  constructor(private readonly mutateSource: () => Promise<void>) {}

  async probe(): Promise<void> {}

  async translateChunk(input: TranslateChunkInput): Promise<RawCodexChunkOutput> {
    if (!this.hasMutated) {
      this.hasMutated = true;
      await this.mutateSource();
    }
    return {
      chunk_index: input.chunk.chunkIndex,
      segments: input.chunk.segments.map((segment) => ({
        id: segment.id,
        translated_text: segment.text.replaceAll(
          "Brilliant Source",
          "変更前の翻訳見出し",
        ).replaceAll("Body.", "変更前の翻訳本文。"),
      })),
      warnings: [],
    };
  }
}

class CancelAfterOutputTranslationClient implements TranslationClient {
  private hasCanceled = false;

  constructor(private readonly requestCancel: () => Promise<void>) {}

  async probe(): Promise<void> {}

  async translateChunk(input: TranslateChunkInput): Promise<RawCodexChunkOutput> {
    if (!this.hasCanceled) {
      this.hasCanceled = true;
      await this.requestCancel();
    }
    return {
      chunk_index: input.chunk.chunkIndex,
      segments: input.chunk.segments.map((segment) => ({
        id: segment.id,
        translated_text: segment.text.replaceAll(
          "Brilliant Source",
          "キャンセル前の翻訳見出し",
        ).replaceAll("Body.", "キャンセル前の翻訳本文。"),
      })),
      warnings: [],
    };
  }
}

class FailThenCancelTranslationClient implements TranslationClient {
  callCount = 0;

  constructor(private readonly requestCancel: () => Promise<void>) {}

  async probe(): Promise<void> {}

  async translateChunk(input: TranslateChunkInput): Promise<RawCodexChunkOutput> {
    this.callCount += 1;
    if (this.callCount === 1) {
      await this.requestCancel();
      throw new Error("transient failure after cancellation");
    }
    return {
      chunk_index: input.chunk.chunkIndex,
      segments: input.chunk.segments.map((segment) => ({
        id: segment.id,
        translated_text: segment.text.replaceAll(
          "Brilliant Source",
          "再試行された翻訳見出し",
        ).replaceAll("Body.", "再試行された翻訳本文。"),
      })),
      warnings: [],
    };
  }
}

class ValidationRetryTranslationClient implements TranslationClient {
  readonly inputs: TranslateChunkInput[] = [];
  private callCount = 0;

  async probe(): Promise<void> {}

  async translateChunk(input: TranslateChunkInput): Promise<RawCodexChunkOutput> {
    this.callCount += 1;
    this.inputs.push(input);
    return {
      chunk_index: input.chunk.chunkIndex,
      segments: input.chunk.segments.map((segment) => ({
        id: segment.id,
        translated_text: this.translateSegment(segment.text),
      })),
      warnings: [],
    };
  }

  private translateSegment(text: string): string {
    if (this.callCount === 1 && text === "Read ") {
      return "読む `agents.md`";
    }
    return text
      .replaceAll("Brilliant Source", "華麗なソース")
      .replaceAll("Read ", "読む ")
      .replaceAll("docs", "資料")
      .replaceAll(" and ", " と ");
  }
}

class CodeHeavyValidationRetryTranslationClient implements TranslationClient {
  readonly inputs: TranslateChunkInput[] = [];
  private callCount = 0;

  async probe(): Promise<void> {}

  async translateChunk(input: TranslateChunkInput): Promise<RawCodexChunkOutput> {
    this.callCount += 1;
    this.inputs.push(input);
    return {
      chunk_index: input.chunk.chunkIndex,
      segments: input.chunk.segments.map((segment, index) => ({
        id: segment.id,
        translated_text: this.translateSegment(segment.text, index),
      })),
      warnings: [],
    };
  }

  private translateSegment(text: string, index: number): string {
    if (this.callCount === 1 && index === 0) {
      return `${text} \`agents.md\``;
    }
    return `翻訳済み ${text}`;
  }
}

class EmptySegmentRetryTranslationClient implements TranslationClient {
  readonly inputs: TranslateChunkInput[] = [];
  private callCount = 0;

  async probe(): Promise<void> {}

  async translateChunk(input: TranslateChunkInput): Promise<RawCodexChunkOutput> {
    this.callCount += 1;
    this.inputs.push(input);
    return {
      chunk_index: input.chunk.chunkIndex,
      segments: input.chunk.segments.map((segment, index) => ({
        id: segment.id,
        translated_text: this.callCount === 1 && index === 0
          ? "   "
          : `翻訳済み ${segment.text}`,
      })),
      warnings: [],
    };
  }
}

class DiagnosticFailingTranslationClient implements TranslationClient {
  constructor(private readonly diagnostic: string) {}

  async probe(): Promise<void> {}

  async translateChunk(): Promise<RawCodexChunkOutput> {
    throw new CodexAppServerError(
      "app_server_protocol_error",
      this.diagnostic,
    );
  }
}

class CloseTrackingTranslationClient extends FakeTranslationClient {
  closeCalls = 0;

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

class ProbeFailingCloseTrackingTranslationClient
  extends CloseTrackingTranslationClient {
  override async probe(): Promise<void> {
    throw new Error("probe failed");
  }
}

async function createMemoryRow(config: ResolvedTraumaConfig): Promise<void> {
  const connection = initializeDatabase(config);
  try {
    await connection.repositories.memories.create({
      id: memoryId,
      url: "https://example.com/brilliant",
      title: "Brilliant Source",
      description: null,
      faviconUrl: null,
      contentPath: `memories/${memoryId}/CONTENT.md`,
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "disabled",
      lastBackupAt: null,
      lastBackupError: null,
      createdAt: now,
      updatedAt: now,
    });
  } finally {
    connection.close();
  }
}

async function writeSourceContent(
  config: ResolvedTraumaConfig,
  markdown = "# Brilliant Source\n\nBody.",
): Promise<void> {
  const filePath = join(config.storePath, "memories", memoryId, "CONTENT.md");
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    createMemoryContentFixture({
      frontmatter: {
        capturedAt: now.toISOString(),
        extractionStatus: "success",
        id: memoryId,
        title: "Brilliant Source",
        url: "https://example.com/brilliant",
      },
      markdown,
    }),
    "utf8",
  );
}

async function createConfig(): Promise<ResolvedTraumaConfig> {
  const root = await mkdtemp(join(tmpdir(), "trauma-translation-runner-"));
  tempRoots.push(root);
  return {
    configFilePath: join(root, "trauma.config.json"),
    projectPath: join(root, "data"),
    storePath: join(root, "data/storage"),
    databasePath: join(root, ".trauma/trauma.sqlite"),
    backup: {
      git: {
        enabled: false,
        remote: "origin",
        branch: "main",
        push: false,
        commitMessageTemplate: "backup {action} {memoryId}",
      },
    },
  };
}

async function waitForJobStatus(
  config: ResolvedTraumaConfig,
  jobId: string,
  status: string,
): Promise<void> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    const connection = initializeDatabase(config);
    try {
      const job = await connection.repositories.translations.getTranslationJob(jobId);
      if (job?.status === status) {
        return;
      }
    } finally {
      connection.close();
    }
    await delay(10);
  }

  const connection = initializeDatabase(config);
  try {
    const job = await connection.repositories.translations.getTranslationJob(jobId);
    throw new Error(`expected job ${jobId} to reach ${status}, got ${job?.status}`);
  } finally {
    connection.close();
  }
}

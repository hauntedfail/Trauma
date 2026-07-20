import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const successMemoryId = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef111";
const fallbackMemoryId = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef112";
const capturedAt = new Date("2026-05-09T06:00:00.000Z");

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("add memory orchestration", () => {
  it("coalesces concurrent idempotent creates and reuses the durable row on retry", async () => {
    const root = await makeRoot();
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { addMemory } from "./src/server/memories/add-memory.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const config = createConfig(root);
        const firstConnection = initializeDatabase(config);
        const secondConnection = initializeDatabase(config);
        const idempotencyKey = ${JSON.stringify(successMemoryId)};
        let importCalls = 0;
        const importer = {
          importUrl: async () => {
            importCalls += 1;
            await Promise.resolve();
            return {
              status: "success",
              url: "https://example.com/idempotent",
              title: "Idempotent",
              description: null,
              faviconUrl: null,
              markdown: "# Idempotent\\n\\nCreated once.",
            };
          },
        };
        const input = (db) => ({
          url: "https://example.com/idempotent",
          idempotencyKey,
          config,
          db,
          importer,
          backupQueue: {
            enqueue: async () => {
              throw new Error("backup should be disabled");
            },
          },
          generateId: () => "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef999",
          now: () => new Date(${JSON.stringify(capturedAt.toISOString())}),
        });

        try {
          const [first, concurrent] = await Promise.all([
            addMemory(input(firstConnection.db)),
            addMemory(input(secondConnection.db)),
          ]);
          const retried = await addMemory(input(secondConnection.db));
          let conflictingRetry;
          try {
            await addMemory({
              ...input(secondConnection.db),
              url: "https://example.com/different",
            });
          } catch (error) {
            conflictingRetry = {
              name: error instanceof Error ? error.name : "UnknownError",
              message: error instanceof Error ? error.message : String(error),
            };
          }
          const existingMemoryId = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef203";
          await secondConnection.repositories.memories.create({
            id: existingMemoryId,
            url: "https://example.com/preexisting",
            title: "Preexisting",
            description: null,
            faviconUrl: null,
            contentPath: "memories/" + existingMemoryId + "/CONTENT.md",
            extractionStatus: "success",
            extractionError: null,
            backupStatus: "disabled",
            lastBackupAt: null,
            lastBackupError: null,
            createdAt: new Date(${JSON.stringify(capturedAt.toISOString())}),
            updatedAt: new Date(${JSON.stringify(capturedAt.toISOString())}),
          });
          let existingIdClaim;
          try {
            await addMemory({
              ...input(secondConnection.db),
              idempotencyKey: existingMemoryId,
              url: "https://example.com/claim",
            });
          } catch (error) {
            existingIdClaim = {
              name: error instanceof Error ? error.name : "UnknownError",
              message: error instanceof Error ? error.message : String(error),
            };
          }
          const rows = secondConnection.sqlite
            .prepare("select id, url from memories where id = ?")
            .all(idempotencyKey);

          const existingIdReservationCount = secondConnection.sqlite
            .prepare("select count(*) as count from memory_creation_idempotency where idempotency_key = ?")
            .get(existingMemoryId).count;

          process.stdout.write(JSON.stringify({ first, concurrent, retried, conflictingRetry, existingIdClaim, existingIdReservationCount, rows, importCalls }));
        } finally {
          firstConnection.close();
          secondConnection.close();
        }

        function createConfig(root) {
          return {
            configFilePath: join(root, "trauma.config.json"),
            projectPath: join(root, "data"),
            storePath: join(root, "data/store"),
            databasePath: join(root, ".trauma/trauma.sqlite"),
            backup: {
              git: {
                enabled: false,
                remote: "origin",
                branch: "main",
                push: false,
                commitMessageTemplate: "backup memory {memoryId}",
              },
            },
          };
        }
      `,
      root,
    );
    const {
      first,
      concurrent,
      retried,
      conflictingRetry,
      existingIdClaim,
      existingIdReservationCount,
      rows,
      importCalls,
    } = JSON.parse(output);

    expect(first.id).toBe(successMemoryId);
    expect(concurrent.id).toBe(successMemoryId);
    expect(retried.id).toBe(successMemoryId);
    expect(conflictingRetry).toEqual({
      name: "AddMemoryIdempotencyConflictError",
      message: "Idempotency-Key was already used for a different URL",
    });
    expect(existingIdClaim).toEqual({
      name: "AddMemoryIdempotencyConflictError",
      message: "Idempotency-Key was already used for a different URL",
    });
    expect(existingIdReservationCount).toBe(0);
    expect(rows).toEqual([
      { id: successMemoryId, url: "https://example.com/idempotent" },
    ]);
    expect(importCalls).toBe(1);
  });

  it("does not recreate a deleted memory when its idempotency key is replayed", async () => {
    const root = await makeRoot();
    const output = runBunScript(
      `
        import { access } from "node:fs/promises";
        import { dirname, join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import {
          AddMemoryIdempotencyReplayError,
          addMemory,
        } from "./src/server/memories/add-memory.ts";
        import { deleteMemory } from "./src/server/memories/delete-memory.ts";
        import { resolveMemoryContentPath } from "./src/server/store/memory-content.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const config = createConfig(root);
        const connection = initializeDatabase(config);
        const idempotencyKey = ${JSON.stringify(successMemoryId)};
        let importCalls = 0;
        const input = {
          url: "https://example.com/deleted-replay",
          idempotencyKey,
          config,
          db: connection.db,
          importer: {
            importUrl: async () => {
              importCalls += 1;
              return {
                status: "success",
                url: "https://example.com/deleted-replay",
                title: "Deleted replay",
                description: null,
                faviconUrl: null,
                markdown: "# Deleted replay",
              };
            },
          },
          backupQueue: {
            enqueue: async () => ({ backupStatus: "disabled" }),
          },
          now: () => new Date(${JSON.stringify(capturedAt.toISOString())}),
        };

        try {
          await addMemory(input);
          const deleted = await deleteMemory({
            config,
            db: connection.db,
            memoryId: idempotencyKey,
          });
          let replayError;
          try {
            await addMemory(input);
          } catch (error) {
            replayError = {
              isReplayError: error instanceof AddMemoryIdempotencyReplayError,
              message: error instanceof Error ? error.message : String(error),
            };
          }
          const row = await connection.repositories.memories.findById(idempotencyKey);
          const contentDirectory = dirname(
            resolveMemoryContentPath(config, idempotencyKey).absolutePath,
          );
          let contentDirectoryExists = true;
          try {
            await access(contentDirectory);
          } catch {
            contentDirectoryExists = false;
          }
          const reservationCount = connection.sqlite
            .prepare("select count(*) as count from memory_creation_idempotency where idempotency_key = ?")
            .get(idempotencyKey).count;

          process.stdout.write(JSON.stringify({
            contentDirectoryExists,
            deleted,
            importCalls,
            replayError,
            reservationCount,
            row: row ?? null,
          }));
        } finally {
          connection.close();
        }

        function createConfig(root) {
          return {
            configFilePath: join(root, "trauma.config.json"),
            projectPath: join(root, "data"),
            storePath: join(root, "data/store"),
            databasePath: join(root, ".trauma/trauma.sqlite"),
            backup: {
              git: {
                enabled: false,
                remote: "origin",
                branch: "main",
                push: false,
                commitMessageTemplate: "backup memory {memoryId}",
              },
            },
          };
        }
      `,
      root,
    );

    expect(JSON.parse(output)).toEqual({
      contentDirectoryExists: false,
      deleted: { status: "deleted" },
      importCalls: 1,
      replayError: {
        isReplayError: true,
        message: "Idempotency-Key no longer refers to an existing memory",
      },
      reservationCount: 1,
      row: null,
    });
  });

  it("releases a new reservation after a clean initial import failure so the same key can retry", async () => {
    const root = await makeRoot();
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { addMemory } from "./src/server/memories/add-memory.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const config = createConfig(root);
        const connection = initializeDatabase(config);
        const idempotencyKey = ${JSON.stringify(fallbackMemoryId)};
        let importCalls = 0;
        const input = {
          url: "https://example.com/retry-after-import-failure",
          idempotencyKey,
          config,
          db: connection.db,
          importer: {
            importUrl: async () => {
              importCalls += 1;
              if (importCalls === 1) {
                throw new Error("extractor unavailable");
              }
              return {
                status: "success",
                url: "https://example.com/retry-after-import-failure",
                title: "Recovered retry",
                description: null,
                faviconUrl: null,
                markdown: "# Recovered retry",
              };
            },
          },
          backupQueue: {
            enqueue: async () => ({ backupStatus: "disabled" }),
          },
          now: () => new Date(${JSON.stringify(capturedAt.toISOString())}),
        };

        try {
          const originalFindFirst = connection.db.query.memories.findFirst;
          connection.db.query.memories.findFirst = async () => {
            throw new Error("initial row read unavailable");
          };
          let initialReadError;
          try {
            await addMemory(input);
          } catch (error) {
            initialReadError = error instanceof Error ? error.message : String(error);
          } finally {
            connection.db.query.memories.findFirst = originalFindFirst;
          }
          const reservationsAfterReadFailure = connection.sqlite
            .prepare("select count(*) as count from memory_creation_idempotency where idempotency_key = ?")
            .get(idempotencyKey).count;
          let initialError;
          try {
            await addMemory(input);
          } catch (error) {
            initialError = error instanceof Error ? error.message : String(error);
          }
          const reservationsAfterFailure = connection.sqlite
            .prepare("select count(*) as count from memory_creation_idempotency where idempotency_key = ?")
            .get(idempotencyKey).count;
          const retried = await addMemory(input);
          const reservationsAfterRetry = connection.sqlite
            .prepare("select count(*) as count from memory_creation_idempotency where idempotency_key = ?")
            .get(idempotencyKey).count;

          process.stdout.write(JSON.stringify({
            importCalls,
            initialError,
            initialReadError,
            reservationsAfterFailure,
            reservationsAfterReadFailure,
            reservationsAfterRetry,
            retried,
          }));
        } finally {
          connection.close();
        }

        function createConfig(root) {
          return {
            configFilePath: join(root, "trauma.config.json"),
            projectPath: join(root, "data"),
            storePath: join(root, "data/store"),
            databasePath: join(root, ".trauma/trauma.sqlite"),
            backup: {
              git: {
                enabled: false,
                remote: "origin",
                branch: "main",
                push: false,
                commitMessageTemplate: "backup memory {memoryId}",
              },
            },
          };
        }
      `,
      root,
    );

    expect(JSON.parse(output)).toMatchObject({
      importCalls: 2,
      initialError: "extractor unavailable",
      initialReadError: "initial row read unavailable",
      reservationsAfterFailure: 0,
      reservationsAfterReadFailure: 0,
      reservationsAfterRetry: 1,
      retried: {
        id: fallbackMemoryId,
        title: "Recovered retry",
      },
    });
  });

  it("rolls back a linked file when directory durability fails and retries without an orphan", async () => {
    const root = await makeRoot();
    const output = runBunScript(
      `
        import { access, link, open, rm } from "node:fs/promises";
        import { dirname, join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { addMemory } from "./src/server/memories/add-memory.ts";
        import { resolveMemoryContentPath } from "./src/server/store/memory-content.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const config = createConfig(root);
        const connection = initializeDatabase(config);
        const idempotencyKey = ${JSON.stringify(successMemoryId)};
        const contentPath = resolveMemoryContentPath(config, idempotencyKey);
        let importCalls = 0;
        const baseInput = {
          url: "https://example.com/retry-after-directory-sync-failure",
          idempotencyKey,
          config,
          db: connection.db,
          importer: {
            importUrl: async () => {
              importCalls += 1;
              return {
                status: "success",
                url: "https://example.com/retry-after-directory-sync-failure",
                title: "Durable retry",
                description: null,
                faviconUrl: null,
                markdown: "# Durable retry",
              };
            },
          },
          backupQueue: {
            enqueue: async () => ({ backupStatus: "disabled" }),
          },
          now: () => new Date(${JSON.stringify(capturedAt.toISOString())}),
        };
        const atomicCreateFileSystem = {
          link,
          open: async (path, flags, mode) => {
            const handle = await open(path, flags, mode);
            return {
              writeFile: (data, options) => handle.writeFile(data, options),
              sync: () => handle.sync(),
              close: () => handle.close(),
            };
          },
          openDirectory: async (path) => {
            const handle = await open(path, "r");
            return {
              sync: async () => {
                throw Object.assign(
                  new Error("directory sync failed after link"),
                  { code: "EIO" },
                );
              },
              close: () => handle.close(),
            };
          },
          rm: (path, options) => rm(path, options),
        };

        try {
          let initialError = null;
          let initialResult = null;
          try {
            initialResult = await addMemory({
              ...baseInput,
              atomicCreateFileSystem,
            });
          } catch (error) {
            initialError = {
              message: error instanceof Error ? error.message : String(error),
              name: error instanceof Error ? error.name : "UnknownError",
            };
          }

          let contentDirectoryExistsAfterFailure = true;
          try {
            await access(dirname(contentPath.absolutePath));
          } catch {
            contentDirectoryExistsAfterFailure = false;
          }
          let journalExistsAfterFailure = true;
          try {
            await access(join(config.storePath, ".operations", idempotencyKey + ".json"));
          } catch {
            journalExistsAfterFailure = false;
          }
          const rowsAfterFailure = connection.sqlite
            .prepare("select count(*) as count from memories where id = ?")
            .get(idempotencyKey).count;
          const reservationsAfterFailure = connection.sqlite
            .prepare("select count(*) as count from memory_creation_idempotency where idempotency_key = ?")
            .get(idempotencyKey).count;

          const retried = await addMemory(baseInput);
          const finalRows = connection.sqlite
            .prepare("select count(*) as count from memories where id = ?")
            .get(idempotencyKey).count;

          process.stdout.write(JSON.stringify({
            contentDirectoryExistsAfterFailure,
            finalRows,
            importCalls,
            initialError,
            initialResult,
            journalExistsAfterFailure,
            reservationsAfterFailure,
            retried,
            rowsAfterFailure,
          }));
        } finally {
          connection.close();
        }

        function createConfig(root) {
          return {
            configFilePath: join(root, "trauma.config.json"),
            projectPath: join(root, "data"),
            storePath: join(root, "data/store"),
            databasePath: join(root, ".trauma/trauma.sqlite"),
            backup: {
              git: {
                enabled: false,
                remote: "origin",
                branch: "main",
                push: false,
                commitMessageTemplate: "backup memory {memoryId}",
              },
            },
          };
        }
      `,
      root,
    );

    expect(JSON.parse(output)).toMatchObject({
      contentDirectoryExistsAfterFailure: false,
      finalRows: 1,
      importCalls: 2,
      initialError: {
        name: "AtomicCreatePublicationError",
      },
      initialResult: null,
      journalExistsAfterFailure: false,
      reservationsAfterFailure: 0,
      retried: {
        id: successMemoryId,
        title: "Durable retry",
      },
      rowsAfterFailure: 0,
    });
  });

  it("recovers an existing reservation from its durable creation journal without importing again", async () => {
    const root = await makeRoot();
    const output = runBunScript(
      `
        import { access } from "node:fs/promises";
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { addMemory } from "./src/server/memories/add-memory.ts";
        import { persistMemoryCreationJournal } from "./src/server/memories/operation-journal.ts";
        import { resolveMemoryContentPath, writeMemoryContent } from "./src/server/store/memory-content.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const config = createConfig(root);
        const connection = initializeDatabase(config);
        const idempotencyKey = ${JSON.stringify(successMemoryId)};
        const requestUrl = "https://example.com/recover-reservation";
        const createdAt = new Date(${JSON.stringify(capturedAt.toISOString())});
        const contentPath = resolveMemoryContentPath(config, idempotencyKey);
        let importCalls = 0;
        try {
          const newReservation = await connection.repositories.memories
            .reserveCreationIdempotency({
              idempotencyKey,
              requestUrl,
              createdAt,
            });
          const existingReservation = await connection.repositories.memories
            .reserveCreationIdempotency({
              idempotencyKey,
              requestUrl,
              createdAt,
            });
          await persistMemoryCreationJournal({
            config,
            journal: {
              version: 1,
              kind: "memory_creation",
              memory: {
                id: idempotencyKey,
                url: requestUrl,
                title: "Recovered reservation",
                description: null,
                faviconUrl: null,
                contentPath: contentPath.relativePath,
                extractionStatus: "success",
                extractionError: null,
                read: false,
                backupStatus: "disabled",
                createdAt: createdAt.toISOString(),
                updatedAt: createdAt.toISOString(),
              },
            },
          });
          await writeMemoryContent({
            config,
            memoryId: idempotencyKey,
            overwrite: false,
            frontmatter: {
              id: idempotencyKey,
              url: requestUrl,
              title: "Recovered reservation",
              capturedAt: createdAt.toISOString(),
              extractionStatus: "success",
            },
            markdown: "# Recovered reservation",
          });

          const recovered = await addMemory({
            url: requestUrl,
            idempotencyKey,
            config,
            db: connection.db,
            importer: {
              importUrl: async () => {
                importCalls += 1;
                throw new Error("recovery must not import");
              },
            },
            backupQueue: {
              enqueue: async () => ({ backupStatus: "disabled" }),
            },
            now: () => createdAt,
          });
          let journalExists = true;
          try {
            await access(join(config.storePath, ".operations", idempotencyKey + ".json"));
          } catch {
            journalExists = false;
          }
          process.stdout.write(JSON.stringify({
            existingReservation,
            importCalls,
            journalExists,
            newReservation,
            recovered,
          }));
        } finally {
          connection.close();
        }

        function createConfig(root) {
          return {
            configFilePath: join(root, "trauma.config.json"),
            projectPath: join(root, "data"),
            storePath: join(root, "data/store"),
            databasePath: join(root, ".trauma/trauma.sqlite"),
            backup: {
              git: {
                enabled: false,
                remote: "origin",
                branch: "main",
                push: false,
                commitMessageTemplate: "backup memory {memoryId}",
              },
            },
          };
        }
      `,
      root,
    );

    expect(JSON.parse(output)).toMatchObject({
      newReservation: {
        status: "new_reservation",
        requestUrl: "https://example.com/recover-reservation",
      },
      existingReservation: {
        status: "existing_reservation",
        requestUrl: "https://example.com/recover-reservation",
      },
      importCalls: 0,
      journalExists: false,
      recovered: {
        id: successMemoryId,
        title: "Recovered reservation",
      },
    });
  });

  it("creates SQLite metadata, writes markdown, and enqueues backup after successful extraction", async () => {
    const root = await makeRoot();
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { addMemory } from "./src/server/memories/add-memory.ts";
        import { readMemoryContent } from "./src/server/store/memory-content.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const config = createConfig(root);
        const connection = initializeDatabase(config);
        const enqueued = [];

        try {
          const result = await addMemory({
            url: "https://example.com/article",
            config,
            db: connection.db,
            importer: {
              importUrl: async () => ({
                status: "success",
                url: "https://example.com/article",
                title: "Extracted Title",
                description: "Extracted description",
                faviconUrl: "https://example.com/favicon.ico",
                markdown: "# Extracted Title\\n\\nImported markdown body.",
              }),
            },
            backupQueue: {
              enqueue: async (input) => {
                enqueued.push(input);
                return { backupStatus: "queued" };
              },
            },
            generateId: () => ${JSON.stringify(successMemoryId)},
            now: () => new Date(${JSON.stringify(capturedAt.toISOString())}),
          });
          const stored = await connection.repositories.memories.findById(${JSON.stringify(successMemoryId)});
          const content = await readMemoryContent({
            config: { storePath: config.storePath },
            memoryId: ${JSON.stringify(successMemoryId)},
          });

          process.stdout.write(JSON.stringify({ result, stored, content, enqueued }));
        } finally {
          connection.close();
        }

        function createConfig(root) {
          return {
            configFilePath: join(root, "trauma.config.json"),
            projectPath: join(root, "data"),
            storePath: join(root, "data/store"),
            databasePath: join(root, ".trauma/trauma.sqlite"),
            backup: {
              git: {
                enabled: true,
                remote: "origin",
                branch: "main",
                push: false,
                commitMessageTemplate: "backup memory {memoryId}",
              },
            },
          };
        }
      `,
      root,
    );
    const { result, stored, content, enqueued } = JSON.parse(output);

    expect(result).toMatchObject({
      id: successMemoryId,
      title: "Extracted Title",
      extractionStatus: "success",
      backupStatus: "queued",
    });

    expect(stored).toMatchObject({
      id: successMemoryId,
      url: "https://example.com/article",
      title: "Extracted Title",
      description: "Extracted description",
      faviconUrl: "https://example.com/favicon.ico",
      contentPath: `memories/${successMemoryId}/CONTENT.md`,
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "queued",
    });

    expect(content.frontmatter).toEqual({
      id: successMemoryId,
      url: "https://example.com/article",
      title: "Extracted Title",
      capturedAt: "2026-05-09T06:00:00.000Z",
      extractionStatus: "success",
    });
    expect(content.markdown).toBe(
      "# Extracted Title\n\nImported markdown body.",
    );
    expect(content.markdown).not.toContain("<html");
    expect(enqueued).toEqual([
      {
        memoryId: successMemoryId,
        contentPaths: [`memories/${successMemoryId}/CONTENT.md`],
        reason: "memory_creation",
      },
    ]);
  });

  it("imports fetched HTML through Defuddle into configured storage, SQLite, and reader output", async () => {
    const root = await makeRoot();
    const memoryId = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef118";
    const output = runBunScript(
      `
        import { readFile } from "node:fs/promises";
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { importUrl } from "./src/server/importer/index.ts";
        import { addMemory } from "./src/server/memories/add-memory.ts";
        import { loadReaderMemory } from "./src/server/reader/page-data.ts";
        import { readMemoryContent } from "./src/server/store/memory-content.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const config = createConfig(root);
        const connection = initializeDatabase(config);
        const memoryId = ${JSON.stringify(memoryId)};

        try {
          const result = await addMemory({
            url: "https://example.com/importable-defuddle",
            config,
            db: connection.db,
            importer: {
              importUrl: (input) =>
                importUrl({
                  url: input.url,
                  resolveHostname: async () => ["93.184.216.34"],
                  fetch: async () =>
                    new Response(
                      \`<!doctype html>
                      <html>
                        <head>
                          <title>Fallback Defuddle Title</title>
                          <meta property="og:title" content="Defuddle Import">
                          <meta name="description" content="Content extracted by Defuddle.">
                          <link rel="icon" href="/favicon.ico">
                        </head>
                        <body>
                          <header>global header clutter</header>
                          <aside>sidebar clutter</aside>
                          <article>
                            <h1>Defuddle Import</h1>
                            <p>This paragraph has enough readable words for the importer to preserve the article as a Markdown memory.</p>
                            <p>The stored file should be written under the configured store path and rendered by the reader pipeline.</p>
                            <p><a href="/reader-safe">reader safe link</a></p>
                            <p><a href="javascript:alert(1)">unsafe link</a></p>
                          </article>
                        </body>
                      </html>\`,
                      {
                        headers: {
                          "content-type": "text/html; charset=utf-8",
                        },
                      },
                    ),
                }),
            },
            backupQueue: {
              enqueue: async () => {
                throw new Error("backup should be disabled");
              },
            },
            generateId: () => memoryId,
            now: () => new Date(${JSON.stringify(capturedAt.toISOString())}),
          });
          const stored = await connection.repositories.memories.findById(memoryId);
          const sqliteRow = connection.sqlite
            .prepare("select id, url, title, content_path as contentPath, extraction_status as extractionStatus, extraction_error as extractionError, backup_status as backupStatus from memories where id = ?")
            .get(memoryId);
          const content = await readMemoryContent({
            config: { storePath: config.storePath },
            memoryId,
          });
          const diskContent = await readFile(
            join(config.storePath, stored.contentPath),
            "utf8",
          );
          const reader = await loadReaderMemory(memoryId, { config });

          process.stdout.write(
            JSON.stringify({ result, stored, sqliteRow, content, diskContent, reader }),
          );
        } finally {
          connection.close();
        }

        function createConfig(root) {
          return {
            configFilePath: join(root, "trauma.config.json"),
            projectPath: join(root, "data"),
            storePath: join(root, "data/store"),
            databasePath: join(root, ".trauma/trauma.sqlite"),
            backup: {
              git: {
                enabled: false,
                remote: "origin",
                branch: "main",
                push: false,
                commitMessageTemplate: "backup memory {memoryId}",
              },
            },
          };
        }
      `,
      root,
    );
    const { result, stored, sqliteRow, content, diskContent, reader } =
      JSON.parse(output);

    expect(result).toMatchObject({
      id: memoryId,
      title: "Defuddle Import",
      extractionStatus: "success",
      backupStatus: "disabled",
    });
    expect(stored).toMatchObject({
      id: memoryId,
      url: "https://example.com/importable-defuddle",
      title: "Defuddle Import",
      description: "Content extracted by Defuddle.",
      faviconUrl: "https://example.com/favicon.ico",
      contentPath: `memories/${memoryId}/CONTENT.md`,
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "disabled",
    });
    expect(sqliteRow).toEqual({
      id: memoryId,
      url: "https://example.com/importable-defuddle",
      title: "Defuddle Import",
      contentPath: `memories/${memoryId}/CONTENT.md`,
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "disabled",
    });
    expect(content.frontmatter).toEqual({
      id: memoryId,
      url: "https://example.com/importable-defuddle",
      title: "Defuddle Import",
      capturedAt: "2026-05-09T06:00:00.000Z",
      extractionStatus: "success",
    });
    expect(content.markdown).toContain("configured store path");
    expect(content.markdown).toContain(
      "[reader safe link](https://example.com/reader-safe)",
    );
    expect(content.markdown).toContain("unsafe link");
    expect(content.markdown).not.toContain("javascript:");
    expect(content.markdown).not.toContain("sidebar clutter");
    expect(content.markdown).not.toContain("<article");
    expect(diskContent).toContain('extraction_status: "success"');
    expect(diskContent).toContain(content.markdown);
    expect(reader.status).toBe("ready");
    expect(reader.memory).toMatchObject({
      id: memoryId,
      title: "Defuddle Import",
      contentPath: `memories/${memoryId}/CONTENT.md`,
    });
    expect(reader.content).toMatchObject({
      relativePath: `memories/${memoryId}/CONTENT.md`,
    });
    expect(reader.content.variants).toEqual([
      {
        active: true,
        kind: "source",
        label: "Original",
        readerUrl: `/memories/${memoryId}`,
        relativePath: `memories/${memoryId}/CONTENT.md`,
      },
    ]);
    expect(reader.rendered.html).toContain("reader safe link");
    expect(reader.rendered.html).toContain("configured store path");
  });

  it("creates a link-only memory when extraction falls back", async () => {
    const root = await makeRoot();
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { addMemory } from "./src/server/memories/add-memory.ts";
        import { readMemoryContent } from "./src/server/store/memory-content.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const config = createConfig(root);
        const connection = initializeDatabase(config);
        const enqueued = [];

        try {
          await addMemory({
            url: "https://example.com/wiki/Foo_(bar)?q=]",
            config,
            db: connection.db,
            importer: {
              importUrl: async () => ({
                status: "link_only",
                url: "https://example.com/wiki/Foo_(bar)?q=]",
                title: "example.com",
                extractionError: "fetch failed: network unavailable",
              }),
            },
            backupQueue: {
              enqueue: async (input) => {
                enqueued.push(input);
                return { backupStatus: "queued" };
              },
            },
            generateId: () => ${JSON.stringify(fallbackMemoryId)},
            now: () => new Date(${JSON.stringify(capturedAt.toISOString())}),
          });
          const stored = await connection.repositories.memories.findById(${JSON.stringify(fallbackMemoryId)});
          const content = await readMemoryContent({
            config: { storePath: config.storePath },
            memoryId: ${JSON.stringify(fallbackMemoryId)},
          });

          process.stdout.write(JSON.stringify({ stored, content, enqueued }));
        } finally {
          connection.close();
        }

        function createConfig(root) {
          return {
            configFilePath: join(root, "trauma.config.json"),
            projectPath: join(root, "data"),
            storePath: join(root, "data/store"),
            databasePath: join(root, ".trauma/trauma.sqlite"),
            backup: {
              git: {
                enabled: true,
                remote: "origin",
                branch: "main",
                push: false,
                commitMessageTemplate: "backup memory {memoryId}",
              },
            },
          };
        }
      `,
      root,
    );
    const { stored, content, enqueued } = JSON.parse(output);

    expect(stored).toMatchObject({
      id: fallbackMemoryId,
      url: "https://example.com/wiki/Foo_(bar)?q=]",
      title: "example.com",
      description: null,
      faviconUrl: null,
      extractionStatus: "link_only",
      extractionError: "fetch failed: network unavailable",
      backupStatus: "queued",
    });

    expect(content.frontmatter.extractionStatus).toBe("link_only");
    expect(content.markdown).toBe(
      "[https://example.com/wiki/Foo_(bar)?q=\\]](<https://example.com/wiki/Foo_(bar)?q=]>)",
    );
    expect(enqueued).toHaveLength(1);
  });

  it("preserves memory creation and marks backup failed when enqueue fails", async () => {
    const root = await makeRoot();
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { addMemory } from "./src/server/memories/add-memory.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const config = createConfig(root);
        const connection = initializeDatabase(config);

        try {
          const result = await addMemory({
            url: "https://example.com/backup-fails",
            config,
            db: connection.db,
            importer: {
              importUrl: async () => ({
                status: "success",
                url: "https://example.com/backup-fails",
                title: "Backup Fails",
                description: null,
                faviconUrl: null,
                markdown: "# Backup Fails\\n\\nImported markdown body.",
              }),
            },
            backupQueue: {
              enqueue: async () => {
                const credential = ["queue", "credential"].join("-");
                throw new Error(
                  "queue unavailable for https://backup-user:" +
                    credential +
                    "@example.com/private.git Bearer " +
                    credential,
                );
              },
            },
            generateId: () => ${JSON.stringify("018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef113")},
            now: () => new Date(${JSON.stringify(capturedAt.toISOString())}),
          });

          process.stdout.write(JSON.stringify({ result }));
        } finally {
          connection.close();
        }

        function createConfig(root) {
          return {
            configFilePath: join(root, "trauma.config.json"),
            projectPath: join(root, "data"),
            storePath: join(root, "data/store"),
            databasePath: join(root, ".trauma/trauma.sqlite"),
            backup: {
              git: {
                enabled: true,
                remote: "origin",
                branch: "main",
                push: false,
                commitMessageTemplate: "backup memory {memoryId}",
              },
            },
          };
        }
      `,
      root,
    );
    const { result } = JSON.parse(output);

    expect(result).toMatchObject({
      id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef113",
      backupStatus: "failed",
    });
    expect(result.lastBackupError).toContain("queue unavailable");
    expect(result.lastBackupError).toContain("[redacted]");
    expect(result.lastBackupError).not.toContain("queue-credential");
    expect(result.lastBackupError.length).toBeLessThanOrEqual(4_096);
  });

  it("returns the created memory when queued-status persistence fails after insert", async () => {
    const root = await makeRoot();
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { addMemory } from "./src/server/memories/add-memory.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const config = createConfig(root);
        const connection = initializeDatabase(config);

        try {
          const originalRun = connection.db.update;
          let shouldFailBackupUpdate = false;
          connection.db.update = (...args) => {
            if (shouldFailBackupUpdate) {
              throw new Error("backup update unavailable");
            }

            return originalRun.call(connection.db, ...args);
          };

          const result = await addMemory({
            url: "https://example.com/update-fails",
            config,
            db: connection.db,
            importer: {
              importUrl: async () => ({
                status: "success",
                url: "https://example.com/update-fails",
                title: "Backup Update Fails",
                description: null,
                faviconUrl: null,
                markdown: "# Backup Update Fails\\n\\nImported markdown body.",
              }),
            },
            backupQueue: {
              enqueue: async () => {
                shouldFailBackupUpdate = true;
                return { backupStatus: "queued" };
              },
            },
            generateId: () => ${JSON.stringify("018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef115")},
            now: () => new Date(${JSON.stringify(capturedAt.toISOString())}),
          });
          const stored = await connection.repositories.memories.findById(${JSON.stringify("018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef115")});

          process.stdout.write(JSON.stringify({ result, stored }));
        } finally {
          connection.close();
        }

        function createConfig(root) {
          return {
            configFilePath: join(root, "trauma.config.json"),
            projectPath: join(root, "data"),
            storePath: join(root, "data/store"),
            databasePath: join(root, ".trauma/trauma.sqlite"),
            backup: {
              git: {
                enabled: true,
                remote: "origin",
                branch: "main",
                push: false,
                commitMessageTemplate: "backup memory {memoryId}",
              },
            },
          };
        }
      `,
      root,
    );
    const { result, stored } = JSON.parse(output);

    expect(result).toMatchObject({
      id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef115",
      backupStatus: "pending",
      lastBackupError: null,
    });
    expect(stored).toMatchObject({
      id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef115",
      backupStatus: "pending",
    });
  });

  it("returns queued memory when post-update read-back is unavailable", async () => {
    const root = await makeRoot();
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { addMemory } from "./src/server/memories/add-memory.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const config = createConfig(root);
        const connection = initializeDatabase(config);

        try {
          connection.db.query.memories.findFirst = async () => {
            throw new Error("read-back unavailable");
          };

          const memoryId = ${JSON.stringify("018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef117")};
          const result = await addMemory({
            url: "https://example.com/update-readback-fails",
            config,
            db: connection.db,
            importer: {
              importUrl: async () => ({
                status: "success",
                url: "https://example.com/update-readback-fails",
                title: "Update Readback Fails",
                description: null,
                faviconUrl: null,
                markdown: "# Update Readback Fails\\n\\nImported markdown body.",
              }),
            },
            backupQueue: {
              enqueue: async () => ({ backupStatus: "queued" }),
            },
            generateId: () => memoryId,
            now: () => new Date(${JSON.stringify(capturedAt.toISOString())}),
          });
          const stored = connection.sqlite
            .prepare("select id, backup_status as backupStatus, last_backup_error as lastBackupError from memories where id = ?")
            .get(memoryId);

          process.stdout.write(JSON.stringify({ result, stored }));
        } finally {
          connection.close();
        }

        function createConfig(root) {
          return {
            configFilePath: join(root, "trauma.config.json"),
            projectPath: join(root, "data"),
            storePath: join(root, "data/store"),
            databasePath: join(root, ".trauma/trauma.sqlite"),
            backup: {
              git: {
                enabled: true,
                remote: "origin",
                branch: "main",
                push: false,
                commitMessageTemplate: "backup memory {memoryId}",
              },
            },
          };
        }
      `,
      root,
    );
    const { result, stored } = JSON.parse(output);

    expect(result).toMatchObject({
      id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef117",
      backupStatus: "queued",
      lastBackupError: null,
    });
    expect(stored).toEqual({
      id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef117",
      backupStatus: "queued",
      lastBackupError: null,
    });
  });

  it("does not report backup status update success when the memory row is missing", async () => {
    const root = await makeRoot();
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const connection = initializeDatabase(createConfig(root));

        try {
          let result;
          try {
            result = await connection.repositories.memories.updateBackupStatus({
              id: "missing-memory",
              backupStatus: "failed",
              lastBackupAt: null,
              lastBackupError: "queue failed",
              updatedAt: new Date(${JSON.stringify(capturedAt.toISOString())}),
            });
          } catch (error) {
            result = {
              errorName: error instanceof Error ? error.name : "UnknownError",
              message: error instanceof Error ? error.message : String(error),
            };
          }

          process.stdout.write(JSON.stringify(result));
        } finally {
          connection.close();
        }

        function createConfig(root) {
          return {
            configFilePath: join(root, "trauma.config.json"),
            projectPath: join(root, "data"),
            storePath: join(root, "data/store"),
            databasePath: join(root, ".trauma/trauma.sqlite"),
            backup: {
              git: {
                enabled: true,
                remote: "origin",
                branch: "main",
                push: false,
                commitMessageTemplate: "backup memory {memoryId}",
              },
            },
          };
        }
      `,
      root,
    );

    expect(JSON.parse(output)).toMatchObject({
      errorName: "MemoryRepositoryError",
      message: expect.stringContaining("missing-memory"),
    });
  });

  it("does not delete content when post-insert read-back is unavailable", async () => {
    const root = await makeRoot();
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { addMemory } from "./src/server/memories/add-memory.ts";
        import { readMemoryContent } from "./src/server/store/memory-content.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const config = createConfig(root);
        const connection = initializeDatabase(config);

        try {
          connection.db.query.memories.findFirst = async () => {
            throw new Error("read-back unavailable");
          };

          const memoryId = ${JSON.stringify("018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef116")};
          const result = await addMemory({
            url: "https://example.com/readback-fails",
            config,
            db: connection.db,
            importer: {
              importUrl: async () => ({
                status: "success",
                url: "https://example.com/readback-fails",
                title: "Readback Fails",
                description: null,
                faviconUrl: null,
                markdown: "# Readback Fails\\n\\nImported markdown body.",
              }),
            },
            backupQueue: {
              enqueue: async () => {
                throw new Error("backup should be disabled");
              },
            },
            generateId: () => memoryId,
            now: () => new Date(${JSON.stringify(capturedAt.toISOString())}),
          });
          const stored = connection.sqlite
            .prepare("select id, content_path as contentPath from memories where id = ?")
            .get(memoryId);
          const content = await readMemoryContent({
            config: { storePath: config.storePath },
            memoryId,
          });

          process.stdout.write(JSON.stringify({ result, stored, content }));
        } finally {
          connection.close();
        }

        function createConfig(root) {
          return {
            configFilePath: join(root, "trauma.config.json"),
            projectPath: join(root, "data"),
            storePath: join(root, "data/store"),
            databasePath: join(root, ".trauma/trauma.sqlite"),
            backup: {
              git: {
                enabled: false,
                remote: "origin",
                branch: "main",
                push: false,
                commitMessageTemplate: "backup memory {memoryId}",
              },
            },
          };
        }
      `,
      root,
    );
    const { result, stored, content } = JSON.parse(output);

    expect(result).toMatchObject({
      id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef116",
      backupStatus: "disabled",
    });
    expect(stored).toEqual({
      id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef116",
      contentPath: "memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef116/CONTENT.md",
    });
    expect(content.markdown).toBe(
      "# Readback Fails\n\nImported markdown body.",
    );
  });

  it("does not replace existing content when generated memory ID collides", async () => {
    const root = await makeRoot();
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { addMemory } from "./src/server/memories/add-memory.ts";
        import {
          readMemoryContent,
          writeMemoryContent,
        } from "./src/server/store/memory-content.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const config = createConfig(root);
        const connection = initializeDatabase(config);

        try {
          const memoryId = ${JSON.stringify("018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef117")};
          await writeMemoryContent({
            config: { storePath: config.storePath },
            memoryId,
            frontmatter: {
              id: memoryId,
              url: "https://example.com/original",
              title: "Original",
              capturedAt: ${JSON.stringify(capturedAt.toISOString())},
              extractionStatus: "success",
            },
            markdown: "# Original\\n\\nKeep this existing memory.",
          });
          await connection.repositories.memories.create({
            id: memoryId,
            url: "https://example.com/original",
            title: "Original",
            description: null,
            faviconUrl: null,
            contentPath: \`memories/\${memoryId}/CONTENT.md\`,
            extractionStatus: "success",
            extractionError: null,
            backupStatus: "disabled",
            lastBackupAt: null,
            lastBackupError: null,
            createdAt: new Date(${JSON.stringify(capturedAt.toISOString())}),
            updatedAt: new Date(${JSON.stringify(capturedAt.toISOString())}),
          });

          let errorMessage = null;
          try {
            await addMemory({
              url: "https://example.com/collision",
              config,
              db: connection.db,
              importer: {
                importUrl: async () => ({
                  status: "success",
                  url: "https://example.com/collision",
                  title: "Collision",
                  description: null,
                  faviconUrl: null,
                  markdown: "# Collision\\n\\nThis must not replace existing content.",
                }),
              },
              backupQueue: {
                enqueue: async () => {
                  throw new Error("backup should be disabled");
                },
              },
              generateId: () => memoryId,
              now: () => new Date(${JSON.stringify(capturedAt.toISOString())}),
            });
          } catch (error) {
            errorMessage = error instanceof Error ? error.message : String(error);
          }

          const stored = await connection.repositories.memories.findById(memoryId);
          const content = await readMemoryContent({
            config: { storePath: config.storePath },
            memoryId,
          });

          process.stdout.write(JSON.stringify({ errorMessage, stored, content }));
        } finally {
          connection.close();
        }

        function createConfig(root) {
          return {
            configFilePath: join(root, "trauma.config.json"),
            projectPath: join(root, "data"),
            storePath: join(root, "data/store"),
            databasePath: join(root, ".trauma/trauma.sqlite"),
            backup: {
              git: {
                enabled: false,
                remote: "origin",
                branch: "main",
                push: false,
                commitMessageTemplate: "backup memory {memoryId}",
              },
            },
          };
        }
      `,
      root,
    );
    const { errorMessage, stored, content } = JSON.parse(output);

    expect(errorMessage).toContain("CONTENT.md already exists");
    expect(stored).toMatchObject({
      id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef117",
      url: "https://example.com/original",
      title: "Original",
    });
    expect(content.markdown).toBe("# Original\n\nKeep this existing memory.");
  });

  it("leaves backup pending when the no-op queue boundary is used", async () => {
    const root = await makeRoot();
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { createNoopMemoryBackupQueue } from "./src/server/backup/index.ts";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { addMemory } from "./src/server/memories/add-memory.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const config = createConfig(root);
        const connection = initializeDatabase(config);

        try {
          const result = await addMemory({
            url: "https://example.com/noop-backup",
            config,
            db: connection.db,
            importer: {
              importUrl: async () => ({
                status: "success",
                url: "https://example.com/noop-backup",
                title: "Noop Backup",
                description: null,
                faviconUrl: null,
                markdown: "# Noop Backup\\n\\nImported markdown body.",
              }),
            },
            backupQueue: createNoopMemoryBackupQueue(),
            generateId: () => ${JSON.stringify("018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef114")},
            now: () => new Date(${JSON.stringify(capturedAt.toISOString())}),
          });

          process.stdout.write(JSON.stringify({ result }));
        } finally {
          connection.close();
        }

        function createConfig(root) {
          return {
            configFilePath: join(root, "trauma.config.json"),
            projectPath: join(root, "data"),
            storePath: join(root, "data/store"),
            databasePath: join(root, ".trauma/trauma.sqlite"),
            backup: {
              git: {
                enabled: true,
                remote: "origin",
                branch: "main",
                push: false,
                commitMessageTemplate: "backup memory {memoryId}",
              },
            },
          };
        }
      `,
      root,
    );
    const { result } = JSON.parse(output);

    expect(result).toMatchObject({
      id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef114",
      backupStatus: "pending",
      lastBackupError: null,
    });
  });
});

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "trauma-add-memory-"));
  tempDirs.push(root);
  return root;
}

function runBunScript(script: string, root: string) {
  try {
    return execFileSync("bun", ["-e", script], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        TRAUMA_TEST_ROOT: root,
      },
    });
  } catch (error) {
    if (!isSpawnMissing(error)) {
      throw error;
    }

    const repositoryRoot = process.cwd();
    return execFileSync(
      "mise",
      ["exec", "-C", repositoryRoot, "--", "bun", "-e", script],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          MISE_TRUSTED_CONFIG_PATHS: join(repositoryRoot, "mise.toml"),
          TRAUMA_TEST_ROOT: root,
        },
      },
    );
  }
}

function isSpawnMissing(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

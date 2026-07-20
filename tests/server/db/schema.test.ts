import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";

import { schema } from "../../../src/server/db";
import { readBundledMigrations } from "../../../src/server/db/bundled-migrations";

const PRODUCT_LANGUAGE_MIGRATION_FOLDER_MILLIS = 1778934734173;
const VARIANT_LOCAL_FLASHBACKS_MIGRATION_FOLDER_MILLIS = 1779449000000;
const STRICT_FLASHBACK_VARIANT_SCOPE_MIGRATION_FOLDER_MILLIS = 1779449500000;
const MEMORY_BROWSE_PAGINATION_MIGRATION_FOLDER_MILLIS = 1779955000000;
const SCRUB_BACKUP_SECRETS_MIGRATION_FOLDER_MILLIS = 1784221790920;
const MOMENT_PATH_IDENTITY_MIGRATION_FOLDER_MILLIS = 1784223792512;
const SCRUB_MEMORY_BACKUP_ERRORS_MIGRATION_FOLDER_MILLIS = 1784232000000;
const MEMORY_CREATION_IDEMPOTENCY_MIGRATION_FOLDER_MILLIS = 1784234421333;
const CASE_INSENSITIVE_TAXONOMY_MIGRATION_FOLDER_MILLIS = 1784238332412;
const COLLECTION_BROWSE_INDEXES_MIGRATION_FOLDER_MILLIS = 1784534032874;

describe("db foundation", () => {
  it("exports all foundation tables", () => {
    expect(Object.keys(schema).sort()).toEqual([
      "appSettings",
      "backupEnvironmentStamps",
      "backupFailsafeAlerts",
      "categories",
      "flashbacks",
      "memories",
      "memoryCategories",
      "memoryCreationIdempotency",
      "memoryTags",
      "moments",
      "openaiAuthCredentials",
      "tags",
      "translationChunks",
      "translationJobs",
      "translationProjectionSpans",
    ]);
  });

  it("opens a temporary SQLite database from resolved config", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { initializeDatabase } from "./src/server/db/index.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const connection = initializeDatabase({
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
          });

          try {
            const memory = await connection.repositories.memories.findById("018f04a2-3c6f-7c88-9a8b-8c99a9b7f001");
            process.stdout.write(JSON.stringify({
              memory,
              tables: connection.sqlite
                .prepare("select name from sqlite_master where type = 'table' and name = 'memories'")
                .all(),
            }));
          } finally {
            connection.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    expect(JSON.parse(output)).toEqual({
      tables: [{ name: "memories" }],
    });
  });

  it("lists memory browse rows from SQLite metadata and relations", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { initializeDatabase } from "./src/server/db/index.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const now = Date.now();
          const connection = initializeDatabase({
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
          });

          try {
            connection.sqlite
              .prepare(\`
                insert into memories (
                  id,
                  url,
                  title,
                  description,
                  content_path,
                  extraction_status,
                  backup_status,
                  created_at,
                  updated_at
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
              \`)
              .run(
                "018f04a2-3c6f-7c88-9a8b-8c99a9b7f003",
                "https://example.com/real-memory",
                "Real SQLite Memory",
                "Saved from the repository",
                "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f003/CONTENT.md",
                "success",
                "pending",
                now,
                now,
              );
            connection.sqlite.prepare("insert into categories (id, name, created_at, updated_at) values (?, ?, ?, ?)").run("research", "Research", now, now);
            connection.sqlite.prepare("insert into tags (id, name, created_at, updated_at) values (?, ?, ?, ?)").run("sqlite", "sqlite", now, now);
            connection.sqlite.prepare("insert into memory_categories (memory_id, category_id, created_at, updated_at) values (?, ?, ?, ?)").run("018f04a2-3c6f-7c88-9a8b-8c99a9b7f003", "research", now, now);
            connection.sqlite.prepare("insert into memory_tags (memory_id, tag_id, created_at, updated_at) values (?, ?, ?, ?)").run("018f04a2-3c6f-7c88-9a8b-8c99a9b7f003", "sqlite", now, now);
            connection.sqlite
              .prepare("insert into flashbacks (id, memory_id, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .run("f-real", "018f04a2-3c6f-7c88-9a8b-8c99a9b7f003", "repository flashback", "from", "sqlite", 0, 20, now, now);

            const memories = await connection.repositories.memories.listForBrowse();
            process.stdout.write(JSON.stringify(memories));
          } finally {
            connection.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    const memories = JSON.parse(output);
    expect(memories[0]?.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(memories[0]?.flashbacks[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(memories).toEqual([
      {
        id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f003",
        title: "Real SQLite Memory",
        url: "https://example.com/real-memory",
        description: "Saved from the repository",
        capturedAt: memories[0].capturedAt,
        read: false,
        extractionStatus: "success",
        categories: [{ id: "research", name: "Research" }],
        tags: [{ id: "sqlite", name: "sqlite" }],
        flashbacks: [
          {
            id: "f-real",
            memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f003",
            memoryTitle: "Real SQLite Memory",
            variantKind: "source",
            langCode: null,
            translationOutputHash: null,
            text: "repository flashback",
            prefix: "from",
            suffix: "sqlite",
            startOffset: 0,
            endOffset: 20,
            contentHash: null,
            createdAt: memories[0].flashbacks[0].createdAt,
          },
        ],
      },
    ]);
  });

  it("applies migrations when launched outside the project cwd", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const launchedFrom = mkdtempSync(join(tmpdir(), "trauma-cwd-"));
    const dbModuleUrl = pathToFileURL(join(process.cwd(), "src/server/db/index.ts"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { initializeDatabase } from "${dbModuleUrl.href}";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const connection = initializeDatabase({
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
          });

          try {
            process.stdout.write(JSON.stringify({
              tables: connection.sqlite
                .prepare("select name from sqlite_master where type = 'table' and name = 'memories'")
                .all(),
            }));
          } finally {
            connection.close();
          }
        `,
      {
        cwd: launchedFrom,
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    expect(JSON.parse(output)).toEqual({
      tables: [{ name: "memories" }],
    });
  });

  it("keeps bundled migrations in sync with the reviewable drizzle files", () => {
    expect(readBundledMigrations()).toEqual(
      readMigrationFiles({ migrationsFolder: join(process.cwd(), "drizzle") }),
    );
  });

  it("upgrades an existing Bun SQLite database with durable creation identities", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { Database } from "bun:sqlite";
          import { readBundledMigrations } from "./src/server/db/bundled-migrations.ts";
          import { applyRuntimeMigrations } from "./src/server/db/migrations.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) throw new Error("TRAUMA_TEST_DB_ROOT is required");
          const sqlite = new Database(join(root, "trauma.sqlite"));
          try {
            sqlite.run("PRAGMA foreign_keys = ON");
            const migrations = readBundledMigrations();
            applyRuntimeMigrations(
              sqlite,
              migrations.filter(
                (migration) => migration.folderMillis < ${MEMORY_CREATION_IDEMPOTENCY_MIGRATION_FOLDER_MILLIS},
              ),
              "previous",
            );
            sqlite.prepare("insert into memories (id, url, title, content_path, extraction_status, backup_status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
              .run("018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef301", "https://example.com/existing", "Existing", "memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef301/CONTENT.md", "success", "disabled", 1, 1);

            applyRuntimeMigrations(sqlite, migrations, "bundled");
            sqlite.prepare("insert into memory_creation_idempotency (idempotency_key, request_url, created_at) values (?, ?, ?)")
              .run("018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef302", "https://example.com/new", 2);

            process.stdout.write(JSON.stringify({
              existingMemory: sqlite.prepare("select id from memories where id = ?")
                .get("018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef301"),
              reservation: sqlite.prepare("select idempotency_key as idempotencyKey, request_url as requestUrl from memory_creation_idempotency")
                .get(),
              foreignKeyViolations: sqlite.prepare("PRAGMA foreign_key_check").all(),
              migrationRecorded: sqlite.prepare("select count(*) as count from __drizzle_migrations where created_at = ?")
                .get(${MEMORY_CREATION_IDEMPOTENCY_MIGRATION_FOLDER_MILLIS}).count,
            }));
          } finally {
            sqlite.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: { ...process.env, TRAUMA_TEST_DB_ROOT: root },
      },
    );

    expect(JSON.parse(output)).toEqual({
      existingMemory: { id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef301" },
      reservation: {
        idempotencyKey: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef302",
        requestUrl: "https://example.com/new",
      },
      foreignKeyViolations: [],
      migrationRecorded: 1,
    });
  });

  it("deduplicates case-variant taxonomy identities while preserving assignments", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { Database } from "bun:sqlite";
          import { readBundledMigrations } from "./src/server/db/bundled-migrations.ts";
          import { applyRuntimeMigrations } from "./src/server/db/migrations.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) throw new Error("TRAUMA_TEST_DB_ROOT is required");
          const sqlite = new Database(join(root, "trauma.sqlite"));
          try {
            sqlite.run("PRAGMA foreign_keys = ON");
            const migrations = readBundledMigrations();
            applyRuntimeMigrations(
              sqlite,
              migrations.filter(
                (migration) => migration.folderMillis < ${CASE_INSENSITIVE_TAXONOMY_MIGRATION_FOLDER_MILLIS},
              ),
              "previous",
            );

            const firstMemory = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef311";
            const secondMemory = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef312";
            const insertMemory = sqlite.prepare("insert into memories (id, url, title, content_path, extraction_status, backup_status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)");
            insertMemory.run(firstMemory, "https://example.com/first", "First", "memories/" + firstMemory + "/CONTENT.md", "success", "disabled", 1, 1);
            insertMemory.run(secondMemory, "https://example.com/second", "Second", "memories/" + secondMemory + "/CONTENT.md", "success", "disabled", 1, 1);

            const insertTag = sqlite.prepare("insert into tags (id, name, created_at, updated_at) values (?, ?, ?, ?)");
            insertTag.run("tag-early", "Harness", 10, 20);
            insertTag.run("tag-late", "harness", 30, 40);
            const insertCategory = sqlite.prepare("insert into categories (id, name, created_at, updated_at) values (?, ?, ?, ?)");
            insertCategory.run("category-z", "Research", 10, 20);
            insertCategory.run("category-a", "research", 10, 40);

            const insertMemoryTag = sqlite.prepare("insert into memory_tags (memory_id, tag_id, created_at, updated_at) values (?, ?, ?, ?)");
            insertMemoryTag.run(firstMemory, "tag-early", 100, 110);
            insertMemoryTag.run(firstMemory, "tag-late", 90, 130);
            insertMemoryTag.run(secondMemory, "tag-late", 120, 140);
            const insertMemoryCategory = sqlite.prepare("insert into memory_categories (memory_id, category_id, created_at, updated_at) values (?, ?, ?, ?)");
            insertMemoryCategory.run(firstMemory, "category-z", 100, 110);
            insertMemoryCategory.run(firstMemory, "category-a", 80, 150);
            insertMemoryCategory.run(secondMemory, "category-z", 120, 140);

            applyRuntimeMigrations(sqlite, migrations, "bundled");

            const duplicateErrors = [];
            try {
              insertTag.run("tag-rejected", "HARNESS", 50, 50);
            } catch (error) {
              duplicateErrors.push(error instanceof Error ? error.message : String(error));
            }
            try {
              insertCategory.run("category-rejected", "RESEARCH", 50, 50);
            } catch (error) {
              duplicateErrors.push(error instanceof Error ? error.message : String(error));
            }

            process.stdout.write(JSON.stringify({
              categories: sqlite.prepare("select id, name from categories order by id").all(),
              categoryAssignments: sqlite.prepare("select memory_id as memoryId, category_id as categoryId, created_at as createdAt, updated_at as updatedAt from memory_categories order by memory_id").all(),
              duplicateErrors,
              foreignKeyViolations: sqlite.prepare("PRAGMA foreign_key_check").all(),
              indexes: sqlite.prepare("select name, sql from sqlite_master where type = 'index' and name in ('tags_name_unique', 'categories_name_unique') order by name").all(),
              migrationRecorded: sqlite.prepare("select count(*) as count from __drizzle_migrations where created_at = ?").get(${CASE_INSENSITIVE_TAXONOMY_MIGRATION_FOLDER_MILLIS}).count,
              tags: sqlite.prepare("select id, name from tags order by id").all(),
              tagAssignments: sqlite.prepare("select memory_id as memoryId, tag_id as tagId, created_at as createdAt, updated_at as updatedAt from memory_tags order by memory_id").all(),
            }));
          } finally {
            sqlite.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: { ...process.env, TRAUMA_TEST_DB_ROOT: root },
      },
    );

    expect(JSON.parse(output)).toEqual({
      categories: [{ id: "category-a", name: "research" }],
      categoryAssignments: [
        {
          memoryId: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef311",
          categoryId: "category-a",
          createdAt: 80,
          updatedAt: 150,
        },
        {
          memoryId: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef312",
          categoryId: "category-a",
          createdAt: 120,
          updatedAt: 140,
        },
      ],
      duplicateErrors: [
        expect.stringContaining("UNIQUE constraint failed"),
        expect.stringContaining("UNIQUE constraint failed"),
      ],
      foreignKeyViolations: [],
      indexes: [
        expect.objectContaining({
          name: "categories_name_unique",
          sql: expect.stringContaining("lower(\"name\")"),
        }),
        expect.objectContaining({
          name: "tags_name_unique",
          sql: expect.stringContaining("lower(\"name\")"),
        }),
      ],
      migrationRecorded: 1,
      tags: [{ id: "tag-early", name: "Harness" }],
      tagAssignments: [
        {
          memoryId: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef311",
          tagId: "tag-early",
          createdAt: 90,
          updatedAt: 130,
        },
        {
          memoryId: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef312",
          tagId: "tag-early",
          createdAt: 120,
          updatedAt: 140,
        },
      ],
    });
  });

  it("records bundled migration rows with SQLite integer primary keys", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { initializeDatabase } from "./src/server/db/index.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const connection = initializeDatabase({
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
          });

          try {
            process.stdout.write(JSON.stringify(
              connection.sqlite
                .prepare("select id, typeof(id) as id_type from __drizzle_migrations order by created_at")
                .all(),
            ));
          } finally {
            connection.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    expect(JSON.parse(output)).toEqual(
      Array.from({ length: readBundledMigrations().length }, (_, index) => ({
        id: index + 1,
        id_type: "integer",
      })),
    );
  });

  it("rejects unsupported persisted Codex reasoning effort values", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { initializeDatabase } from "./src/server/db/index.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const now = Date.now();
          const connection = initializeDatabase({
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
          });

          try {
            try {
              connection.sqlite
                .prepare("insert into app_settings (id, translation_target_language, codex_translation_model, codex_translation_reasoning_effort, created_at, updated_at) values (?, ?, ?, ?, ?, ?)")
                .run("default", "ja-JP", "gpt-5.5", "extreme", now, now);
              process.stdout.write(JSON.stringify({ accepted: true }));
            } catch (error) {
              process.stdout.write(JSON.stringify({
                accepted: false,
                message: error instanceof Error ? error.message : String(error),
              }));
            }
          } finally {
            connection.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    expect(JSON.parse(output)).toEqual({
      accepted: false,
      message: expect.stringContaining(
        "app_settings_codex_translation_reasoning_effort_check",
      ),
    });
  });

  it("creates the memory browse cursor pagination index through runtime migrations", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { initializeDatabase } from "./src/server/db/index.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const connection = initializeDatabase({
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
          });

          try {
            process.stdout.write(JSON.stringify({
              indexNames: connection.sqlite
                .prepare("PRAGMA index_list('memories')")
                .all()
                .map((row) => row.name)
                .sort(),
              migrationRecorded: connection.sqlite
                .prepare("select count(*) as count from __drizzle_migrations where created_at = ?")
                .get(${MEMORY_BROWSE_PAGINATION_MIGRATION_FOLDER_MILLIS}).count,
            }));
          } finally {
            connection.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    expect(JSON.parse(output)).toEqual({
      indexNames: expect.arrayContaining(["memories_created_at_id_idx"]),
      migrationRecorded: 1,
    });
  });

  it("uses composite indexes for Flashback and Moment browse ordering", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { Database } from "bun:sqlite";
          import { desc, eq } from "drizzle-orm";
          import { drizzle } from "drizzle-orm/bun-sqlite";
          import { readBundledMigrations } from "./src/server/db/bundled-migrations.ts";
          import { applyRuntimeMigrations } from "./src/server/db/migrations.ts";
          import {
            buildFlashbackBrowseCursorWhere,
            buildMomentBrowseCursorWhere,
          } from "./src/server/db/repositories.ts";
          import * as schema from "./src/server/db/schema.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const sqlite = new Database(join(root, "trauma.sqlite"));

          try {
            sqlite.run("PRAGMA foreign_keys = ON");
            const migrations = readBundledMigrations();
            const previousMigrations = migrations.filter(
              (migration) => migration.folderMillis < ${COLLECTION_BROWSE_INDEXES_MIGRATION_FOLDER_MILLIS},
            );
            applyRuntimeMigrations(sqlite, previousMigrations, "previous");

            const previousIndexes = {
              flashbacks: sqlite
                .prepare("PRAGMA index_list('flashbacks')")
                .all()
                .map((row) => row.name),
              moments: sqlite
                .prepare("PRAGMA index_list('moments')")
                .all()
                .map((row) => row.name),
            };

            applyRuntimeMigrations(sqlite, migrations, "bundled");
            const db = drizzle({ client: sqlite, schema });

            const explain = (sql) => sqlite
              .prepare(\`EXPLAIN QUERY PLAN \${sql}\`)
              .all(51)
              .map((row) => row.detail);
            const explainQuery = (query) => sqlite
              .prepare(\`EXPLAIN QUERY PLAN \${query.sql}\`)
              .all(...query.params)
              .map((row) => row.detail);
            const flashbackCursorQuery = db
              .select({ id: schema.flashbacks.id, title: schema.memories.title })
              .from(schema.flashbacks)
              .innerJoin(schema.memories, eq(schema.flashbacks.memoryId, schema.memories.id))
              .where(buildFlashbackBrowseCursorWhere({
                createdAt: new Date(42),
                id: "flashback-cursor",
              }))
              .orderBy(desc(schema.flashbacks.createdAt), desc(schema.flashbacks.id))
              .limit(51)
              .toSQL();
            const momentCursorQuery = db
              .select({ id: schema.moments.id, title: schema.memories.title })
              .from(schema.moments)
              .innerJoin(schema.memories, eq(schema.moments.memoryId, schema.memories.id))
              .where(buildMomentBrowseCursorWhere({
                createdAt: new Date(42),
                id: "moment-cursor",
              }))
              .orderBy(desc(schema.moments.createdAt), desc(schema.moments.id))
              .limit(51)
              .toSQL();

            process.stdout.write(JSON.stringify({
              previousIndexes,
              flashbacks: explain(\`
                select flashbacks.id, memories.title
                from flashbacks
                inner join memories on flashbacks.memory_id = memories.id
                order by flashbacks.created_at desc, flashbacks.id desc
                limit ?
              \`),
              moments: explain(\`
                select moments.id, memories.title
                from moments
                inner join memories on moments.memory_id = memories.id
                order by moments.created_at desc, moments.id desc
                limit ?
              \`),
              flashbackCursor: explainQuery(flashbackCursorQuery),
              momentCursor: explainQuery(momentCursorQuery),
              foreignKeyViolations: sqlite.prepare("PRAGMA foreign_key_check").all(),
              migrationRecorded: sqlite
                .prepare("select count(*) as count from __drizzle_migrations where created_at = ?")
                .get(${COLLECTION_BROWSE_INDEXES_MIGRATION_FOLDER_MILLIS}).count,
            }));
          } finally {
            sqlite.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    const plans = JSON.parse(output) as {
      previousIndexes: {
        flashbacks: string[];
        moments: string[];
      };
      flashbacks: string[];
      moments: string[];
      flashbackCursor: string[];
      momentCursor: string[];
      foreignKeyViolations: unknown[];
      migrationRecorded: number;
    };

    expect(plans.previousIndexes.flashbacks).toContain(
      "flashbacks_created_at_idx",
    );
    expect(plans.previousIndexes.moments).toContain("moments_created_at_idx");
    expect(plans.flashbacks).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "SCAN flashbacks USING INDEX flashbacks_created_at_id_idx",
        ),
      ]),
    );
    expect(plans.moments).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "SCAN moments USING INDEX moments_created_at_id_idx",
        ),
      ]),
    );
    expect(plans.flashbackCursor).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "SEARCH flashbacks USING INDEX flashbacks_created_at_id_idx",
        ),
      ]),
    );
    expect(plans.momentCursor).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "SEARCH moments USING INDEX moments_created_at_id_idx",
        ),
      ]),
    );
    expect([
      ...plans.flashbacks,
      ...plans.moments,
      ...plans.flashbackCursor,
      ...plans.momentCursor,
    ]).not.toEqual(
      expect.arrayContaining([expect.stringContaining("TEMP B-TREE")]),
    );
    expect(plans.foreignKeyViolations).toEqual([]);
    expect(plans.migrationRecorded).toBe(1);
  });

  it("scrubs legacy backup remote credentials and push diagnostics", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { Database } from "bun:sqlite";
          import { readBundledMigrations } from "./src/server/db/bundled-migrations.ts";
          import { applyRuntimeMigrations } from "./src/server/db/migrations.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) throw new Error("TRAUMA_TEST_DB_ROOT is required");
          const sqlite = new Database(join(root, "trauma.sqlite"));
          const migrations = readBundledMigrations();
          const previous = migrations.filter(
            (migration) => migration.folderMillis < ${SCRUB_BACKUP_SECRETS_MIGRATION_FOLDER_MILLIS},
          );
          applyRuntimeMigrations(sqlite, previous, "bundled");
          const secret = "migration-secret";
          const now = Date.now();
          sqlite.prepare("insert into backup_environment_stamps (id, project_path, store_path, git_remote, git_remote_url, git_branch, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
            .run("default", "/project", "/project/store", "origin", "https://user:" + secret + "@example.com/repo.git", "main", now, now);
          sqlite.prepare("insert into backup_failsafe_alerts (id, kind, severity, message, previous_project_path, previous_store_path, current_project_path, current_store_path, git_remote, git_remote_url, git_branch, error, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run("active", "backup_push_failed", "critical", "Backup push failed", null, null, "/project", "/project/store", "origin", "https://user:" + secret + "@example.com/repo.git", "main", "fatal token=" + secret, now, now);
          applyRuntimeMigrations(sqlite, migrations, "bundled");
          const stamp = sqlite.prepare("select git_remote_url from backup_environment_stamps where id = 'default'").get();
          const alert = sqlite.prepare("select git_remote_url, error from backup_failsafe_alerts where id = 'active'").get();
          const migrationRecorded = sqlite.prepare("select count(*) as count from __drizzle_migrations where created_at = ?")
            .get(${SCRUB_BACKUP_SECRETS_MIGRATION_FOLDER_MILLIS}).count;
          sqlite.close();
          process.stdout.write(JSON.stringify({ stamp, alert, migrationRecorded }));
        `,
      {
        cwd: process.cwd(),
        env: { ...process.env, TRAUMA_TEST_DB_ROOT: root },
      },
    );

    expect(JSON.parse(output)).toEqual({
      stamp: { git_remote_url: "redacted:migration-0016" },
      alert: { git_remote_url: null, error: null },
      migrationRecorded: 1,
    });
    expect(output).not.toContain("migration-secret");
  });

  it("scrubs legacy per-memory backup diagnostics", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { Database } from "bun:sqlite";
          import { readBundledMigrations } from "./src/server/db/bundled-migrations.ts";
          import { applyRuntimeMigrations } from "./src/server/db/migrations.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) throw new Error("TRAUMA_TEST_DB_ROOT is required");
          const sqlite = new Database(join(root, "trauma.sqlite"));
          const migrations = readBundledMigrations();
          const previous = migrations.filter(
            (migration) => migration.folderMillis < ${SCRUB_MEMORY_BACKUP_ERRORS_MIGRATION_FOLDER_MILLIS},
          );
          applyRuntimeMigrations(sqlite, previous, "bundled");
          const credential = ["migration", "credential"].join("-");
          const now = Date.now();
          sqlite.prepare("insert into memories (id, url, title, content_path, extraction_status, backup_status, last_backup_error, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run("memory-secret", "https://example.com", "Secret", "memories/memory-secret/CONTENT.md", "success", "failed", "fatal https://user:" + credential + "@example.com/repo.git", now, now);
          sqlite.prepare("insert into backup_environment_stamps (id, project_path, store_path, git_remote, git_remote_url, git_branch, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
            .run("default", "/project", "/project/store", "origin", "https://user:" + credential + "@example.com/repo.git", "main", now, now);
          applyRuntimeMigrations(sqlite, migrations, "bundled");
          const memory = sqlite.prepare("select last_backup_error from memories where id = 'memory-secret'").get();
          const stamp = sqlite.prepare("select git_remote_url from backup_environment_stamps where id = 'default'").get();
          const migrationRecorded = sqlite.prepare("select count(*) as count from __drizzle_migrations where created_at = ?")
            .get(${SCRUB_MEMORY_BACKUP_ERRORS_MIGRATION_FOLDER_MILLIS}).count;
          sqlite.close();
          process.stdout.write(JSON.stringify({ memory, stamp, migrationRecorded }));
        `,
      {
        cwd: process.cwd(),
        env: { ...process.env, TRAUMA_TEST_DB_ROOT: root },
      },
    );

    expect(JSON.parse(output)).toEqual({
      memory: { last_backup_error: null },
      stamp: { git_remote_url: "redacted:migration-0016" },
      migrationRecorded: 1,
    });
    expect(output).not.toContain("migration-credential");
  });

  it("deterministically reconciles legacy Moment path duplicates before enforcing identity", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { Database } from "bun:sqlite";
          import { readBundledMigrations } from "./src/server/db/bundled-migrations.ts";
          import { applyRuntimeMigrations } from "./src/server/db/migrations.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const sqlite = new Database(join(root, "trauma.sqlite"));

          try {
            sqlite.run("PRAGMA foreign_keys = ON");
            const migrations = readBundledMigrations();
            const previousMigrations = migrations.filter(
              (migration) => migration.folderMillis < ${MOMENT_PATH_IDENTITY_MIGRATION_FOLDER_MILLIS},
            );
            applyRuntimeMigrations(sqlite, previousMigrations, "previous");

            const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f040";
            sqlite.prepare("insert into memories (id, url, title, content_path, extraction_status, backup_status, read, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .run(memoryId, "https://example.com/moments", "Moments", \`memories/\${memoryId}/CONTENT.md\`, "success", "pending", 0, 50, 50);

            const insertMoment = sqlite.prepare("insert into moments (id, memory_id, section_anchor, section_title, section_level, section_path, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)");
            insertMoment.run("moment-older-update", memoryId, "older-update", "Older update", 2, "1/1", 50, 200);
            insertMoment.run("moment-keeper", memoryId, "keeper", "Keeper", 2, "1/1", 100, 300);
            insertMoment.run("moment-z-tie", memoryId, "tie-id", "Tie id", 2, "1/1", 100, 300);
            insertMoment.run("moment-newer-created", memoryId, "newer-created", "Newer created", 2, "1/1", 200, 300);

            applyRuntimeMigrations(sqlite, migrations, "bundled");

            let duplicateError;
            try {
              insertMoment.run("moment-rejected", memoryId, "rejected", "Rejected", 2, "1/1", 400, 400);
            } catch (error) {
              duplicateError = error instanceof Error ? error.message : String(error);
            }

            process.stdout.write(JSON.stringify({
              moments: sqlite
                .prepare("select id, section_anchor as sectionAnchor, section_title as sectionTitle, section_path as sectionPath from moments")
                .all(),
              indexNames: sqlite
                .prepare("PRAGMA index_list('moments')")
                .all()
                .map((row) => row.name)
                .sort(),
              duplicateError,
              migrationRecorded: sqlite
                .prepare("select count(*) as count from __drizzle_migrations where created_at = ?")
                .get(${MOMENT_PATH_IDENTITY_MIGRATION_FOLDER_MILLIS}).count,
            }));
          } finally {
            sqlite.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    expect(JSON.parse(output)).toEqual({
      moments: [
        {
          id: "moment-keeper",
          sectionAnchor: "keeper",
          sectionTitle: "Keeper",
          sectionPath: "1/1",
        },
      ],
      indexNames: expect.arrayContaining([
        "moments_memory_section_path_unique",
      ]),
      duplicateError: expect.stringContaining(
        "UNIQUE constraint failed: moments.memory_id, moments.section_path",
      ),
      migrationRecorded: 1,
    });
  });


  it("migrates existing memories to unread", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { Database } from "bun:sqlite";
          import { readBundledMigrations } from "./src/server/db/bundled-migrations.ts";
          import { applyRuntimeMigrations } from "./src/server/db/migrations.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const sqlite = new Database(join(root, "trauma.sqlite"));

          try {
            sqlite.run("PRAGMA foreign_keys = ON");
            const migrations = readBundledMigrations();
            const previousMigrations = migrations.filter(
              (migration) => migration.folderMillis < ${PRODUCT_LANGUAGE_MIGRATION_FOLDER_MILLIS},
            );
            applyRuntimeMigrations(sqlite, previousMigrations, "previous");

            const now = Date.now();
            sqlite.prepare("insert into memories (id, url, title, content_path, extraction_status, backup_status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
              .run("018f04a2-3c6f-7c88-9a8b-8c99a9b7f008", "https://example.com", "Example", "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f008/CONTENT.md", "success", "pending", now, now);

            applyRuntimeMigrations(sqlite, migrations, "bundled");

            process.stdout.write(JSON.stringify({
              memory: sqlite.prepare("select id, read from memories where id = ?").get("018f04a2-3c6f-7c88-9a8b-8c99a9b7f008"),
              migrationCount: sqlite.prepare("select count(*) as count from __drizzle_migrations").get().count,
            }));
          } finally {
            sqlite.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    expect(JSON.parse(output)).toEqual({
      memory: {
        id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f008",
        read: 0,
      },
      migrationCount: readBundledMigrations().length,
    });
  });

  it("migrates existing highlight markers and section bookmarks to Flashbacks and Moments", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { Database } from "bun:sqlite";
          import { readBundledMigrations } from "./src/server/db/bundled-migrations.ts";
          import { applyRuntimeMigrations } from "./src/server/db/migrations.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const sqlite = new Database(join(root, "trauma.sqlite"));

          try {
            sqlite.run("PRAGMA foreign_keys = ON");
            const migrations = readBundledMigrations();
            const previousMigrations = migrations.filter(
              (migration) => migration.folderMillis < ${PRODUCT_LANGUAGE_MIGRATION_FOLDER_MILLIS},
            );
            applyRuntimeMigrations(sqlite, previousMigrations, "previous");

            const now = Date.parse("2026-05-15T00:00:00.000Z");
            sqlite.prepare("insert into memories (id, url, title, content_path, extraction_status, backup_status, read, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .run("018f04a2-3c6f-7c88-9a8b-8c99a9b7f018", "https://example.com", "Example", "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f018/CONTENT.md", "success", "pending", 0, now, now);
            sqlite.prepare("insert into highlights (id, memory_id, text, prefix, suffix, start_offset, end_offset, content_hash, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .run("old-highlight", "018f04a2-3c6f-7c88-9a8b-8c99a9b7f018", "marked text", "before", "after", 3, 14, "content-hash", now, now);
            sqlite.prepare("insert into flashbacks (id, memory_id, section_anchor, section_title, section_level, section_path, section_start_offset, section_end_offset, content_hash, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .run("old-flashback", "018f04a2-3c6f-7c88-9a8b-8c99a9b7f018", "intro", "Introduction", 2, "1/1", 0, 42, "section-hash", now, now);

            applyRuntimeMigrations(sqlite, migrations, "bundled");

            process.stdout.write(JSON.stringify({
              flashback: sqlite.prepare("select id, memory_id as memoryId, text, prefix, suffix, start_offset as startOffset, end_offset as endOffset, content_hash as contentHash from flashbacks where id = ?").get("old-highlight"),
              moment: sqlite.prepare("select id, memory_id as memoryId, section_anchor as sectionAnchor, section_title as sectionTitle, section_level as sectionLevel, section_path as sectionPath, section_start_offset as sectionStartOffset, section_end_offset as sectionEndOffset, content_hash as contentHash from moments where id = ?").get("old-flashback"),
              legacyTables: sqlite.prepare("select name from sqlite_master where type = 'table' and name in ('highlights') order by name").all(),
              migrationCount: sqlite.prepare("select count(*) as count from __drizzle_migrations").get().count,
            }));
          } finally {
            sqlite.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    expect(JSON.parse(output)).toEqual({
      flashback: {
        id: "old-highlight",
        memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f018",
        text: "marked text",
        prefix: "before",
        suffix: "after",
        startOffset: 3,
        endOffset: 14,
        contentHash: "content-hash",
      },
      moment: {
        id: "old-flashback",
        memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f018",
        sectionAnchor: "intro",
        sectionTitle: "Introduction",
        sectionLevel: 2,
        sectionPath: "1/1",
        sectionStartOffset: 0,
        sectionEndOffset: 42,
        contentHash: "section-hash",
      },
      legacyTables: [],
      migrationCount: readBundledMigrations().length,
    });
  });

  it("migrates existing Flashbacks to the source content variant", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { Database } from "bun:sqlite";
          import { readBundledMigrations } from "./src/server/db/bundled-migrations.ts";
          import { applyRuntimeMigrations } from "./src/server/db/migrations.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const sqlite = new Database(join(root, "trauma.sqlite"));

          try {
            sqlite.run("PRAGMA foreign_keys = ON");
            const migrations = readBundledMigrations();
            const previousMigrations = migrations.filter(
              (migration) => migration.folderMillis < ${VARIANT_LOCAL_FLASHBACKS_MIGRATION_FOLDER_MILLIS},
            );
            applyRuntimeMigrations(sqlite, previousMigrations, "previous");

            const now = Date.parse("2026-05-24T00:00:00.000Z");
            sqlite.prepare("insert into memories (id, url, title, content_path, extraction_status, backup_status, read, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .run("018f04a2-3c6f-7c88-9a8b-8c99a9b7f030", "https://example.com", "Example", "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f030/CONTENT.md", "success", "pending", 0, now, now);
            sqlite.prepare("insert into flashbacks (id, memory_id, text, prefix, suffix, start_offset, end_offset, content_hash, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .run("existing-flashback", "018f04a2-3c6f-7c88-9a8b-8c99a9b7f030", "marked text", "before", "after", 3, 14, "content-hash", now, now);

            applyRuntimeMigrations(sqlite, migrations, "bundled");

            process.stdout.write(JSON.stringify({
              flashback: sqlite.prepare("select id, variant_kind as variantKind, lang_code as langCode, translation_output_hash as translationOutputHash from flashbacks where id = ?").get("existing-flashback"),
              migrationCount: sqlite.prepare("select count(*) as count from __drizzle_migrations").get().count,
            }));
          } finally {
            sqlite.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    expect(JSON.parse(output)).toEqual({
      flashback: {
        id: "existing-flashback",
        variantKind: "source",
        langCode: null,
        translationOutputHash: null,
      },
      migrationCount: readBundledMigrations().length,
    });
  });

  it("continues from databases that already applied the original variant-local Flashbacks migration", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { Database } from "bun:sqlite";
          import { readBundledMigrations } from "./src/server/db/bundled-migrations.ts";
          import { applyRuntimeMigrations } from "./src/server/db/migrations.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const sqlite = new Database(join(root, "trauma.sqlite"));

          try {
            sqlite.run("PRAGMA foreign_keys = ON");
            const migrations = readBundledMigrations();
            const throughOriginal0013 = migrations.filter(
              (migration) => migration.folderMillis < ${STRICT_FLASHBACK_VARIANT_SCOPE_MIGRATION_FOLDER_MILLIS},
            );
            applyRuntimeMigrations(sqlite, throughOriginal0013, "previous");

            const original0013 = sqlite
              .prepare("select hash from __drizzle_migrations where created_at = ?")
              .get(${VARIANT_LOCAL_FLASHBACKS_MIGRATION_FOLDER_MILLIS});

            applyRuntimeMigrations(sqlite, migrations, "bundled");

            let rejectedInvalidTranslatedRow = false;
            try {
              sqlite.prepare("insert into memories (id, url, title, content_path, extraction_status, backup_status, read, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .run("018f04a2-3c6f-7c88-9a8b-8c99a9b7f031", "https://example.com", "Example", "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f031/CONTENT.md", "success", "pending", 0, 1779449500000, 1779449500000);
              sqlite.prepare("insert into flashbacks (id, memory_id, variant_kind, lang_code, translation_output_hash, text, prefix, suffix, start_offset, end_offset, content_hash, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .run("invalid-translated", "018f04a2-3c6f-7c88-9a8b-8c99a9b7f031", "translation", null, "sha256:" + "a".repeat(64), "marked text", "", "", 0, 11, null, 1779449500000, 1779449500000);
            } catch {
              rejectedInvalidTranslatedRow = true;
            }

            process.stdout.write(JSON.stringify({
              original0013Hash: original0013.hash,
              current0013Hash: migrations.find((migration) => migration.folderMillis === ${VARIANT_LOCAL_FLASHBACKS_MIGRATION_FOLDER_MILLIS}).hash,
              strict0014Recorded: sqlite.prepare("select count(*) as count from __drizzle_migrations where created_at = ?").get(${STRICT_FLASHBACK_VARIANT_SCOPE_MIGRATION_FOLDER_MILLIS}).count,
              migrationCount: sqlite.prepare("select count(*) as count from __drizzle_migrations").get().count,
              rejectedInvalidTranslatedRow,
            }));
          } finally {
            sqlite.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    expect(JSON.parse(output)).toEqual({
      original0013Hash: "aeb1230d75bbed7f4059cfd81762897d856c0bd997ae9f40a04770002dfadd90",
      current0013Hash: "aeb1230d75bbed7f4059cfd81762897d856c0bd997ae9f40a04770002dfadd90",
      strict0014Recorded: 1,
      migrationCount: readBundledMigrations().length,
      rejectedInvalidTranslatedRow: true,
    });
  });

  it("rejects orphan Flashbacks before recording the product-language migration", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { Database } from "bun:sqlite";
          import { readBundledMigrations } from "./src/server/db/bundled-migrations.ts";
          import { applyRuntimeMigrations } from "./src/server/db/migrations.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const sqlite = new Database(join(root, "trauma.sqlite"));

          try {
            sqlite.run("PRAGMA foreign_keys = ON");
            const migrations = readBundledMigrations();
            const previousMigrations = migrations.filter(
              (migration) => migration.folderMillis < ${PRODUCT_LANGUAGE_MIGRATION_FOLDER_MILLIS},
            );
            applyRuntimeMigrations(sqlite, previousMigrations, "previous");

            sqlite.run("PRAGMA foreign_keys = OFF");
            sqlite.prepare("insert into highlights (id, memory_id, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .run("orphan", "missing-memory", "orphan", "", "", 0, 6, Date.now(), Date.now());
            sqlite.run("PRAGMA foreign_keys = ON");

            try {
              applyRuntimeMigrations(sqlite, migrations, "bundled");
              process.stdout.write(JSON.stringify({ rejected: false }));
            } catch (error) {
              process.stdout.write(JSON.stringify({
                rejected: true,
                foreignKeys: sqlite.prepare("PRAGMA foreign_keys").get().foreign_keys,
                message: error instanceof Error ? error.message : String(error),
              }));
            }
          } finally {
            sqlite.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    expect(JSON.parse(output)).toMatchObject({
      rejected: true,
      foreignKeys: 1,
      message: expect.stringContaining("foreign key"),
    });
  });

  it("fails loudly when an applied bundled migration hash drifts", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { Database } from "bun:sqlite";
          import { applyBundledMigrations } from "./src/server/db/migrations.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const sqlite = new Database(join(root, "trauma.sqlite"));

          try {
            applyBundledMigrations(sqlite);
            sqlite.prepare("update __drizzle_migrations set hash = ? where created_at = ?")
              .run("tampered", 1778393646543);

            try {
              applyBundledMigrations(sqlite);
              process.stdout.write(JSON.stringify({ rejected: false }));
            } catch (error) {
              process.stdout.write(JSON.stringify({
                rejected: true,
                message: error instanceof Error ? error.message : String(error),
              }));
            }
          } finally {
            sqlite.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    expect(JSON.parse(output)).toMatchObject({
      rejected: true,
      message: expect.stringContaining("hash mismatch"),
    });
  });

  it("upgrades databases that already recorded the original 0001 migration", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { Database } from "bun:sqlite";
          import { readBundledMigrations } from "./src/server/db/bundled-migrations.ts";
          import { applyBundledMigrations } from "./src/server/db/migrations.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const sqlite = new Database(join(root, "trauma.sqlite"));

          try {
            const migration0000 = readBundledMigrations()
              .find((migration) => migration.folderMillis === 1778308356677);
            if (!migration0000) {
              throw new Error("missing bundled 0000 migration");
            }

            sqlite.run("PRAGMA foreign_keys = ON");
            sqlite.run("CREATE TABLE __drizzle_migrations (id integer primary key autoincrement, hash text NOT NULL, created_at numeric)");
            sqlite.prepare("insert into __drizzle_migrations (hash, created_at) values (?, ?)")
              .run(migration0000.hash, 1778308356677);
            sqlite.prepare("insert into __drizzle_migrations (hash, created_at) values (?, ?)")
              .run("79acaf382478f3958e213cf29076922f9f234d4f8f927a1a1ef5f13e38b0bff0", 1778393646543);

            sqlite.run(\`
              CREATE TABLE memories (
                id text PRIMARY KEY NOT NULL,
                url text NOT NULL,
                title text NOT NULL,
                description text,
                favicon_url text,
                content_path text NOT NULL,
                extraction_status text NOT NULL,
                extraction_error text,
                backup_status text NOT NULL,
                last_backup_at integer,
                last_backup_error text,
                created_at integer NOT NULL,
                updated_at integer NOT NULL
              )
            \`);
            sqlite.run(\`
              CREATE TABLE highlights (
                id text PRIMARY KEY NOT NULL,
                memory_id text NOT NULL,
                text text NOT NULL,
                prefix text NOT NULL,
                suffix text NOT NULL,
                start_offset integer NOT NULL,
                end_offset integer NOT NULL,
                created_at integer NOT NULL,
                updated_at integer NOT NULL,
                FOREIGN KEY (memory_id) REFERENCES memories(id) ON UPDATE no action ON DELETE cascade,
                CONSTRAINT highlights_start_offset_check CHECK(start_offset >= 0),
                CONSTRAINT highlights_end_offset_check CHECK(end_offset >= start_offset)
              )
            \`);
            sqlite.run("CREATE INDEX highlights_memory_id_idx ON highlights (memory_id)");
            sqlite.run("CREATE INDEX highlights_created_at_idx ON highlights (created_at)");

            const now = Date.now();
            sqlite.prepare("insert into memories (id, url, title, content_path, extraction_status, backup_status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
              .run("018f04a2-3c6f-7c88-9a8b-8c99a9b7f007", "https://example.com", "Example", "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f007/CONTENT.md", "success", "pending", now, now);
            sqlite.prepare("insert into highlights (id, memory_id, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .run("existing-flashback", "018f04a2-3c6f-7c88-9a8b-8c99a9b7f007", "valid", "", "", 0, 5, now, now);

            applyBundledMigrations(sqlite);

            process.stdout.write(JSON.stringify({
              checkSql: sqlite.prepare("select sql from sqlite_master where type = 'table' and name = 'flashbacks'").get().sql,
              flashbackCount: sqlite.prepare("select count(*) as count from flashbacks where id = 'existing-flashback'").get().count,
              migrationCount: sqlite.prepare("select count(*) as count from __drizzle_migrations").get().count,
            }));
          } finally {
            sqlite.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    const result = JSON.parse(output);

    expect(result).toMatchObject({
      flashbackCount: 1,
      migrationCount: readBundledMigrations().length,
    });
    expect(result.checkSql).toMatch(/end_offset.*>.*start_offset/s);
  });

  it("fails loudly when the database has newer migrations than the bundled runtime", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { Database } from "bun:sqlite";
          import { applyBundledMigrations } from "./src/server/db/migrations.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const sqlite = new Database(join(root, "trauma.sqlite"));

          try {
            applyBundledMigrations(sqlite);
            sqlite.prepare("insert into __drizzle_migrations (hash, created_at) values (?, ?)")
              .run("future", 9999999999999);

            try {
              applyBundledMigrations(sqlite);
              process.stdout.write(JSON.stringify({ rejected: false }));
            } catch (error) {
              process.stdout.write(JSON.stringify({
                rejected: true,
                message: error instanceof Error ? error.message : String(error),
              }));
            }
          } finally {
            sqlite.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    expect(JSON.parse(output)).toMatchObject({
      rejected: true,
      message: expect.stringContaining("newer bundled migration"),
    });
  });

  it("rejects incompatible migration history when using an explicit migrations folder", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { Database } from "bun:sqlite";
          import { initializeDatabase } from "./src/server/db/index.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const databasePath = join(root, "trauma.sqlite");
          const sqlite = new Database(databasePath);
          try {
            sqlite.run("CREATE TABLE __drizzle_migrations (id integer primary key autoincrement, hash text NOT NULL, created_at numeric)");
            sqlite.prepare("insert into __drizzle_migrations (hash, created_at) values (?, ?)")
              .run("future", 9999999999999);
          } finally {
            sqlite.close();
          }

          try {
            const connection = initializeDatabase(
              {
                configFilePath: join(root, "trauma.config.json"),
                projectPath: join(root, "data"),
                storePath: join(root, "data/store"),
                databasePath,
                backup: {
                  git: {
                    enabled: true,
                    remote: "origin",
                    branch: "main",
                    push: false,
                    commitMessageTemplate: "backup memory {memoryId}",
                  },
                },
              },
              { migrationsFolder: join(process.cwd(), "drizzle") },
            );
            connection.close();
            process.stdout.write(JSON.stringify({ rejected: false }));
          } catch (error) {
            process.stdout.write(JSON.stringify({
              rejected: true,
              message: error instanceof Error ? error.message : String(error),
            }));
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    expect(JSON.parse(output)).toMatchObject({
      rejected: true,
      message: expect.stringContaining("newer explicit-folder migration"),
    });
  });

  it("rolls back breakpoint migration bodies when migration recording fails", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { Database } from "bun:sqlite";
          import { applyBundledMigrations } from "./src/server/db/migrations.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const sqlite = new Database(join(root, "trauma.sqlite"));

          try {
            sqlite.run("CREATE TABLE IF NOT EXISTS __drizzle_migrations (id integer primary key autoincrement, hash text NOT NULL, created_at numeric)");
            sqlite.run(\`
              CREATE TRIGGER fail_migration_record
              BEFORE INSERT ON __drizzle_migrations
              BEGIN
                SELECT RAISE(ABORT, 'record blocked');
              END
            \`);

            try {
              applyBundledMigrations(sqlite);
              process.stdout.write(JSON.stringify({ rejected: false }));
            } catch (error) {
              process.stdout.write(JSON.stringify({
                rejected: true,
                memoryTableCount: sqlite.prepare("select count(*) as count from sqlite_master where type = 'table' and name = 'memories'").get().count,
                migrationRows: sqlite.prepare("select count(*) as count from __drizzle_migrations").get().count,
                message: error instanceof Error ? error.message : String(error),
              }));
            }
          } finally {
            sqlite.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    expect(JSON.parse(output)).toMatchObject({
      rejected: true,
      memoryTableCount: 0,
      migrationRows: 0,
    });
  });

  it("rolls back breakpoint migration body failures while honoring foreign key PRAGMAs", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { Database } from "bun:sqlite";
          import { readBundledMigrations } from "./src/server/db/bundled-migrations.ts";
          import { applyRuntimeMigrations } from "./src/server/db/migrations.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const sqlite = new Database(join(root, "trauma.sqlite"));

          try {
            const migrations = readBundledMigrations();
            const previousMigrations = migrations.filter(
              (migration) => migration.folderMillis < ${PRODUCT_LANGUAGE_MIGRATION_FOLDER_MILLIS},
            );
            applyRuntimeMigrations(sqlite, previousMigrations, "previous");

            sqlite.run("PRAGMA foreign_keys = OFF");
            sqlite.prepare("insert into memories (id, url, title, content_path, extraction_status, backup_status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
              .run("018f04a2-3c6f-7c88-9a8b-8c99a9b7f005", "https://example.com", "Example", "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f005/CONTENT.md", "success", "pending", Date.now(), Date.now());
            sqlite.run("PRAGMA ignore_check_constraints = ON");
            sqlite.prepare("insert into highlights (id, memory_id, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .run("bad-offset", "018f04a2-3c6f-7c88-9a8b-8c99a9b7f005", "bad", "", "", 8, 2, Date.now(), Date.now());
            sqlite.run("PRAGMA ignore_check_constraints = OFF");
            sqlite.run("PRAGMA foreign_keys = ON");

            try {
              applyRuntimeMigrations(sqlite, migrations, "bundled");
              process.stdout.write(JSON.stringify({ rejected: false }));
            } catch (error) {
              process.stdout.write(JSON.stringify({
                rejected: true,
                newTableCount: sqlite.prepare("select count(*) as count from sqlite_master where type = 'table' and name = '__new_flashbacks'").get().count,
                foreignKeys: sqlite.prepare("PRAGMA foreign_keys").get().foreign_keys,
                message: error instanceof Error ? error.message : String(error),
              }));
            }
          } finally {
            sqlite.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    expect(JSON.parse(output)).toMatchObject({
      rejected: true,
      newTableCount: 0,
      foreignKeys: 1,
    });
  });

  it("keeps database initialization off deprecated Bun SQLite and Drizzle private migration APIs", () => {
    const dbFiles = readdirSync(join(process.cwd(), "src/server/db"))
      .filter((fileName) => fileName.endsWith(".ts"))
      .map((fileName) => ({
        fileName,
        source: readFileSync(join(process.cwd(), "src/server/db", fileName), "utf8"),
      }));

    expect(
      dbFiles
        .filter(({ source }) => /\.exec\s*\(/.test(source))
        .map(({ fileName }) => fileName),
    ).toEqual([]);
    expect(
      dbFiles
        .filter(({ source }) =>
          /dialect\.migrate|BunMigrationDatabaseInternals|as unknown as/.test(source),
        )
        .map(({ fileName }) => fileName),
    ).toEqual([]);
  });

  it("rejects invalid persisted memory status values", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { initializeDatabase } from "./src/server/db/index.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const connection = initializeDatabase({
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
          });

          try {
            connection.sqlite
              .prepare(\`
                insert into memories (
                  id,
                  url,
                  title,
                  content_path,
                  extraction_status,
                  backup_status,
                  created_at,
                  updated_at
                ) values (?, ?, ?, ?, ?, ?, ?, ?)
              \`)
              .run(
                "018f04a2-3c6f-7c88-9a8b-8c99a9b7f002",
                "https://example.com",
                "Example",
                "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f002/CONTENT.md",
                "impossible",
                "pending",
                Date.now(),
                Date.now(),
              );
            process.stdout.write(JSON.stringify({ rejected: false }));
          } catch (error) {
            process.stdout.write(JSON.stringify({
              rejected: true,
              message: error instanceof Error ? error.message : String(error),
            }));
          } finally {
            connection.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    expect(JSON.parse(output)).toMatchObject({
      rejected: true,
    });
  });

  it("rejects invalid flashback offsets at the SQLite boundary", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { initializeDatabase } from "./src/server/db/index.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const connection = initializeDatabase({
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
          });

          try {
            const now = Date.now();
            connection.sqlite
              .prepare(\`
                insert into memories (
                  id,
                  url,
                  title,
                  content_path,
                  extraction_status,
                  backup_status,
                  created_at,
                  updated_at
                ) values (?, ?, ?, ?, ?, ?, ?, ?)
              \`)
              .run(
                "018f04a2-3c6f-7c88-9a8b-8c99a9b7f004",
                "https://example.com",
                "Example",
                "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f004/CONTENT.md",
                "success",
                "pending",
                now,
                now,
              );

            connection.sqlite
              .prepare("insert into flashbacks (id, memory_id, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .run("bad-offset", "018f04a2-3c6f-7c88-9a8b-8c99a9b7f004", "bad", "", "", 8, 2, now, now);

            process.stdout.write(JSON.stringify({ rejected: false }));
          } catch (error) {
            process.stdout.write(JSON.stringify({
              rejected: true,
              message: error instanceof Error ? error.message : String(error),
            }));
          } finally {
            connection.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    expect(JSON.parse(output)).toMatchObject({
      rejected: true,
    });
  });

  it("rejects zero-length flashback ranges at the SQLite boundary", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { initializeDatabase } from "./src/server/db/index.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const connection = initializeDatabase({
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
          });

          try {
            const now = Date.now();
            connection.sqlite
              .prepare(\`
                insert into memories (
                  id,
                  url,
                  title,
                  content_path,
                  extraction_status,
                  backup_status,
                  created_at,
                  updated_at
                ) values (?, ?, ?, ?, ?, ?, ?, ?)
              \`)
              .run(
                "018f04a2-3c6f-7c88-9a8b-8c99a9b7f006",
                "https://example.com",
                "Example",
                "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f006/CONTENT.md",
                "success",
                "pending",
                now,
                now,
              );

            connection.sqlite
              .prepare("insert into flashbacks (id, memory_id, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .run("empty-flashback", "018f04a2-3c6f-7c88-9a8b-8c99a9b7f006", "", "", "", 8, 8, now, now);

            process.stdout.write(JSON.stringify({ rejected: false }));
          } catch (error) {
            process.stdout.write(JSON.stringify({
              flashbackCount: connection.sqlite
                .prepare("select count(*) as count from flashbacks where id = 'empty-flashback'")
                .get().count,
              rejected: true,
              message: error instanceof Error ? error.message : String(error),
            }));
          } finally {
            connection.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    expect(JSON.parse(output)).toMatchObject({
      flashbackCount: 0,
      rejected: true,
      message: expect.stringContaining("flashbacks_end_offset_check"),
    });
  });

  it("rejects invalid flashback variant scope at the SQLite boundary", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { initializeDatabase } from "./src/server/db/index.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          const connection = initializeDatabase({
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
          });

          try {
            const now = Date.now();
            connection.sqlite
              .prepare(\`
                insert into memories (
                  id,
                  url,
                  title,
                  content_path,
                  extraction_status,
                  backup_status,
                  created_at,
                  updated_at
                ) values (?, ?, ?, ?, ?, ?, ?, ?)
              \`)
              .run(
                "018f04a2-3c6f-7c88-9a8b-8c99a9b7f031",
                "https://example.com",
                "Example",
                "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f031/CONTENT.md",
                "success",
                "pending",
                now,
                now,
              );

            const errors = [];
            for (const row of [
              ["bad-source-scope", "source", "ja-JP", "sha256:" + "a".repeat(64)],
              ["bad-translation-scope", "translation", null, null],
            ]) {
              try {
                connection.sqlite
                  .prepare("insert into flashbacks (id, memory_id, variant_kind, lang_code, translation_output_hash, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                  .run(row[0], "018f04a2-3c6f-7c88-9a8b-8c99a9b7f031", row[1], row[2], row[3], "bad", "", "", 0, 3, now, now);
              } catch (error) {
                errors.push(error instanceof Error ? error.message : String(error));
              }
            }

            process.stdout.write(JSON.stringify({
              errors,
              flashbackCount: connection.sqlite
                .prepare("select count(*) as count from flashbacks")
                .get().count,
            }));
          } finally {
            connection.close();
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    expect(JSON.parse(output)).toEqual({
      errors: [
        expect.stringContaining("flashbacks_variant_scope_check"),
        expect.stringContaining("flashbacks_variant_scope_check"),
      ],
      flashbackCount: 0,
    });
  });

  it("closes the SQLite handle when initialization fails", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-"));
    const output = runBunScript(
      `
          import { join } from "node:path";
          import { Database } from "bun:sqlite";
          import { initializeDatabase } from "./src/server/db/index.ts";

          const root = process.env.TRAUMA_TEST_DB_ROOT;
          if (!root) {
            throw new Error("TRAUMA_TEST_DB_ROOT is required");
          }

          let closeCalls = 0;
          const originalClose = Database.prototype.close;
          Database.prototype.close = function close(...args) {
            closeCalls += 1;
            return originalClose.apply(this, args);
          };

          try {
            initializeDatabase(
              {
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
              },
              { migrationsFolder: join(root, "missing-migrations") },
            );
            process.stdout.write(JSON.stringify({ failed: false, closeCalls }));
          } catch {
            process.stdout.write(JSON.stringify({ failed: true, closeCalls }));
          } finally {
            Database.prototype.close = originalClose;
          }
        `,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TRAUMA_TEST_DB_ROOT: root,
        },
      },
    );

    expect(JSON.parse(output)).toEqual({
      failed: true,
      closeCalls: 1,
    });
  });
});

function runBunScript(script: string, options: { cwd: string; env: NodeJS.ProcessEnv }) {
  try {
    return execFileSync("bun", ["-e", script], {
      ...options,
      encoding: "utf8",
    });
  } catch (error) {
    if (!isSpawnMissing(error)) {
      throw error;
    }

    const repositoryRoot = process.cwd();
    const scriptWithCwd = `process.chdir(${JSON.stringify(options.cwd)});\n${script}`;
    return execFileSync("mise", ["exec", "-C", repositoryRoot, "--", "bun", "-e", scriptWithCwd], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...options.env,
        MISE_TRUSTED_CONFIG_PATHS: join(repositoryRoot, "mise.toml"),
      },
    });
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

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
                content_path text NOT NULL,
                extraction_status text NOT NULL,
                backup_status text NOT NULL,
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

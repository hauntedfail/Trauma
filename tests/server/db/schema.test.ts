import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";

import { schema } from "../../../src/server/db";
import { readBundledMigrations } from "../../../src/server/db/bundled-migrations";

describe("db foundation", () => {
  it("exports all foundation tables", () => {
    expect(Object.keys(schema).sort()).toEqual([
      "categories",
      "highlights",
      "memories",
      "memoryCategories",
      "memoryTags",
      "tags",
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
              .prepare("insert into highlights (id, memory_id, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .run("h-real", "018f04a2-3c6f-7c88-9a8b-8c99a9b7f003", "repository highlight", "from", "sqlite", 0, 20, now, now);

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
    expect(memories[0]?.highlights[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(memories).toEqual([
      {
        id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f003",
        title: "Real SQLite Memory",
        url: "https://example.com/real-memory",
        description: "Saved from the repository",
        capturedAt: memories[0].capturedAt,
        categories: [{ id: "research", name: "Research" }],
        tags: [{ id: "sqlite", name: "sqlite" }],
        highlights: [
          {
            id: "h-real",
            text: "repository highlight",
            prefix: "from",
            suffix: "sqlite",
            createdAt: memories[0].highlights[0].createdAt,
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

    expect(JSON.parse(output)).toEqual([
      { id: 1, id_type: "integer" },
      { id: 2, id_type: "integer" },
    ]);
  });

  it("honors foreign key PRAGMAs in bundled breakpoint migrations", () => {
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
            sqlite.run("PRAGMA foreign_keys = ON");
            applyBundledMigrations(sqlite);

            sqlite.run("PRAGMA foreign_keys = OFF");
            sqlite.prepare("insert into highlights (id, memory_id, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .run("orphan", "missing-memory", "orphan", "", "", 0, 6, Date.now(), Date.now());
            sqlite.prepare("delete from __drizzle_migrations where created_at = ?")
              .run(1778393646543);
            sqlite.run("PRAGMA foreign_keys = ON");

            applyBundledMigrations(sqlite);

            process.stdout.write(JSON.stringify({
              highlightCount: sqlite.prepare("select count(*) as count from highlights where id = 'orphan'").get().count,
              foreignKeys: sqlite.prepare("PRAGMA foreign_keys").get().foreign_keys,
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
      highlightCount: 1,
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

  it("rejects invalid highlight offsets at the SQLite boundary", () => {
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
              .prepare("insert into highlights (id, memory_id, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
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

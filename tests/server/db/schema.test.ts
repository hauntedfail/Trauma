import { mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { schema } from "../../../src/server/db";

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

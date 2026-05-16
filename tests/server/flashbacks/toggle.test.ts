import { execFileSync } from "node:child_process";
import { accessSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("toggleMemoryFlashback", () => {
  it("persists flashback toggles to SQLite without mutating CONTENT.md", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-flashback-toggle-"));
    const output = runBunScript(
      `
        import { execFileSync } from "node:child_process";
        import { mkdir, readFile } from "node:fs/promises";
        import { join } from "node:path";
        import { initializeDatabase, schema } from "./src/server/db/index.ts";
        import { toggleMemoryFlashback } from "./src/server/flashbacks/toggle.ts";
        import { writeMemoryContent } from "./src/server/store/index.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f301";
        const markdown = [
          "Alpha target appears in the opening paragraph.",
          "",
          "Beta target appears in the detail paragraph.",
        ].join("\\n");
        const startOffset = markdown.lastIndexOf("target");
        const config = {
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
        const connection = initializeDatabase(config);
        const enqueuedJobs = [];
        const backupQueue = {
          enqueue: async (job) => {
            const contentPaths = job.contentPaths ?? (job.contentPath === undefined ? [] : [job.contentPath]);
            const contents = await Promise.all(
              contentPaths.map((contentPath) => readFile(join(config.storePath, contentPath), "utf8")),
            );
            enqueuedJobs.push({
              memoryId: job.memoryId,
              reason: job.reason,
              contentPaths,
              containsMarkedContent: contents.some((content) => content.includes("<mark data-flashback-id")),
            });
            return { backupStatus: "queued" };
          },
        };

        try {
          await connection.db.insert(schema.memories).values({
            id: memoryId,
            url: "https://example.com/flashback-toggle",
            title: "Flashback Toggle",
            description: null,
            faviconUrl: null,
            contentPath: "memories/" + memoryId + "/CONTENT.md",
            extractionStatus: "success",
            extractionError: null,
            backupStatus: "pending",
            lastBackupAt: null,
            lastBackupError: null,
            createdAt: new Date("2026-05-10T00:00:00.000Z"),
            updatedAt: new Date("2026-05-10T00:00:00.000Z"),
          });
          await connection.repositories.backupEnvironment.upsertBackupEnvironmentStamp({
            id: "default",
            projectPath: config.projectPath,
            storePath: config.storePath,
            gitRemote: "origin",
            gitRemoteUrl: null,
            gitBranch: "main",
            createdAt: new Date("2026-05-10T00:00:00.000Z"),
            updatedAt: new Date("2026-05-10T00:00:00.000Z"),
          });
          await mkdir(config.projectPath, { recursive: true });
          execFileSync("git", ["init", "--initial-branch=main"], {
            cwd: config.projectPath,
            env: createGitEnv(),
            stdio: ["ignore", "pipe", "pipe"],
          });
          await writeMemoryContent({
            config,
            memoryId,
            frontmatter: {
              id: memoryId,
              url: "https://example.com/flashback-toggle",
              title: "Flashback Toggle",
              capturedAt: "2026-05-10T00:00:00.000Z",
              extractionStatus: "success",
            },
            markdown,
          });

          const selection = {
            text: "target",
            prefix: "Beta ",
            suffix: " appears",
            startOffset,
            endOffset: startOffset + "target".length,
          };

          const created = await toggleMemoryFlashback({
            memoryId,
            operation: "flashback",
            selection,
            config,
            db: connection.db,
            backupQueue,
            generateId: () => "flashback-created",
            now: () => new Date("2026-05-10T01:00:00.000Z"),
          });
          const fileAfterCreate = await readFile(join(config.storePath, "memories", memoryId, "CONTENT.md"), "utf8");
          const rowsAfterCreate = connection.sqlite
            .prepare("select id, text, prefix, suffix, start_offset, end_offset, content_hash from flashbacks order by start_offset")
            .all();
          const exportAfterCreate = JSON.parse(
            await readFile(join(config.storePath, "memories", memoryId, "FLASHBACKS.json"), "utf8"),
          );

          const removed = await toggleMemoryFlashback({
            memoryId,
            operation: "unflashback",
            selection,
            config,
            db: connection.db,
            backupQueue,
            generateId: () => "unused",
            now: () => new Date("2026-05-10T02:00:00.000Z"),
          });
          const fileAfterRemove = await readFile(join(config.storePath, "memories", memoryId, "CONTENT.md"), "utf8");
          const rowsAfterRemove = connection.sqlite
            .prepare("select id from flashbacks order by start_offset")
            .all();
          const exportAfterRemove = JSON.parse(
            await readFile(join(config.storePath, "memories", memoryId, "FLASHBACKS.json"), "utf8"),
          );
          const memory = connection.sqlite
            .prepare("select backup_status from memories where id = ?")
            .get(memoryId);
          let staleError;
          try {
            await toggleMemoryFlashback({
              memoryId,
              operation: "unflashback",
              selection,
              config,
              db: connection.db,
              backupQueue,
              generateId: () => "unused",
              now: () => new Date("2026-05-10T03:00:00.000Z"),
            });
          } catch (error) {
            staleError = {
              name: error.name,
              code: error.code,
              message: error.message,
            };
          }

          process.stdout.write(JSON.stringify({
            created,
            removed,
            fileAfterCreate,
            rowsAfterCreate,
            exportAfterCreate,
            fileAfterRemove,
            rowsAfterRemove,
            exportAfterRemove,
            enqueuedJobs,
            memory,
            staleError,
          }));
        } finally {
          connection.close();
        }

        function createGitEnv() {
          const env = { ...process.env };
          delete env.GIT_DIR;
          delete env.GIT_WORK_TREE;
          delete env.GIT_INDEX_FILE;
          return env;
        }
      `,
      { TRAUMA_TEST_ROOT: root },
    );

    const result = JSON.parse(output);
    expect(result.created.operation).toBe("flashbacked");
    expect(result.rowsAfterCreate).toEqual([
      {
        id: "flashback-created",
        text: "target",
        prefix: "Beta ",
        suffix: " appears in the detail paragraph.",
        start_offset: 52,
        end_offset: 58,
        content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      },
    ]);
    expect(result.exportAfterCreate).toMatchObject({
      version: 1,
      memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f301",
      flashbacks: [
        {
          id: "flashback-created",
          text: "target",
          startOffset: 52,
          endOffset: 58,
          contentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        },
      ],
    });
    expect(result.fileAfterCreate).not.toContain("<mark data-flashback-id");
    expect(result.fileAfterCreate).toContain(
      "Beta target appears in the detail paragraph.",
    );
    expect(result.removed.operation).toBe("unflashbacked");
    expect(result.fileAfterRemove).not.toContain("<mark data-flashback-id");
    expect(result.rowsAfterRemove).toEqual([]);
    expect(result.exportAfterRemove).toMatchObject({
      version: 1,
      memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f301",
      flashbacks: [],
    });
    expect(result.enqueuedJobs).toEqual([
      {
        memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f301",
        reason: "flashback_update",
        contentPaths: [
          "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f301/FLASHBACKS.json",
        ],
        containsMarkedContent: false,
      },
      {
        memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f301",
        reason: "flashback_update",
        contentPaths: [
          "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f301/FLASHBACKS.json",
        ],
        containsMarkedContent: false,
      },
    ]);
    expect(result.memory).toEqual({ backup_status: "pending" });
    expect(result.staleError).toEqual({
      name: "FlashbackToggleError",
      code: "stale_selection",
      message: "Flashback state changed. Reload the reader and try again.",
    });
  });

  it("stores rendered flashback context around hidden markdown syntax", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-flashback-toggle-"));
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase, schema } from "./src/server/db/index.ts";
        import { toggleMemoryFlashback } from "./src/server/flashbacks/toggle.ts";
        import { writeMemoryContent } from "./src/server/store/index.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f302";
        const markdown = "Alpha **target** omega";
        const config = {
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
        const connection = initializeDatabase(config);

        try {
          await connection.db.insert(schema.memories).values({
            id: memoryId,
            url: "https://example.com/flashback-toggle-rendered",
            title: "Flashback Toggle Rendered",
            description: null,
            faviconUrl: null,
            contentPath: "memories/" + memoryId + "/CONTENT.md",
            extractionStatus: "success",
            extractionError: null,
            backupStatus: "disabled",
            lastBackupAt: null,
            lastBackupError: null,
            createdAt: new Date("2026-05-10T00:00:00.000Z"),
            updatedAt: new Date("2026-05-10T00:00:00.000Z"),
          });
          await writeMemoryContent({
            config,
            memoryId,
            frontmatter: {
              id: memoryId,
              url: "https://example.com/flashback-toggle-rendered",
              title: "Flashback Toggle Rendered",
              capturedAt: "2026-05-10T00:00:00.000Z",
              extractionStatus: "success",
            },
            markdown,
          });

          await toggleMemoryFlashback({
            memoryId,
            operation: "flashback",
            selection: {
              text: "target",
              prefix: "Alpha ",
              suffix: " omega",
              startOffset: "Alpha ".length,
              endOffset: "Alpha target".length,
            },
            config,
            db: connection.db,
            backupQueue: {
              enqueue: async () => ({ backupStatus: "queued" }),
            },
            generateId: () => "flashback-rendered",
            now: () => new Date("2026-05-10T01:00:00.000Z"),
          });

          const row = connection.sqlite
            .prepare("select text, prefix, suffix from flashbacks where id = ?")
            .get("flashback-rendered");
          process.stdout.write(JSON.stringify(row));
        } finally {
          connection.close();
        }
      `,
      { TRAUMA_TEST_ROOT: root },
    );

    expect(JSON.parse(output)).toEqual({
      text: "target",
      prefix: "Alpha ",
      suffix: " omega",
    });
  });
});

function runBunScript(script: string, env: Record<string, string>): string {
  const repositoryRoot = process.cwd();
  return execFileSync(resolveBunExecutable(), ["-e", script], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      BUN_INSTALL_CACHE_DIR: join(repositoryRoot, ".tmp/bun-cache"),
      TMPDIR: join(repositoryRoot, ".tmp/bun-tmp"),
    },
  });
}

function resolveBunExecutable(): string {
  if (process.versions.bun !== undefined) {
    return process.execPath;
  }

  const candidates = [
    process.env.BUN_EXECUTABLE,
    join(homedir(), ".local/share/mise/installs/bun/1.3.13/bin/bun"),
    process.env.npm_execpath,
    "bun",
  ];
  const executable = candidates.find(
    (candidate) =>
      candidate !== undefined &&
      isBunExecutable(candidate) &&
      (candidate.includes("/") ? canAccess(candidate) : true),
  );
  if (executable === undefined) {
    throw new Error("Bun executable is required for flashback toggle tests");
  }

  return executable;
}

function isBunExecutable(path: string): boolean {
  return path === "bun" || path.endsWith("/bun") || path.endsWith("\\bun.exe");
}

function canAccess(path: string): boolean {
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
}

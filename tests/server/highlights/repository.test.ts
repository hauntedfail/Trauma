import { execFileSync } from "node:child_process";
import { accessSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("highlight repository", () => {
  it("lists highlight browse rows with source memory title and context", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-highlights-"));
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const now = Date.parse("2026-05-10T01:00:00.000Z");
        const older = Date.parse("2026-05-09T01:00:00.000Z");
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
          for (const [memoryId, title] of [
            ["018f04a2-3c6f-7c88-9a8b-8c99a9b7f201", "Source Memory"],
            ["018f04a2-3c6f-7c88-9a8b-8c99a9b7f202", "Older Source"],
          ]) {
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
                memoryId,
                "https://example.com/" + memoryId,
                title,
                null,
                "memories/" + memoryId + "/CONTENT.md",
                "success",
                "disabled",
                older,
                older,
              );
          }

          connection.sqlite
            .prepare("insert into highlights (id, memory_id, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run("highlight-new", "018f04a2-3c6f-7c88-9a8b-8c99a9b7f201", "selected text", "before", "after", 8, 21, now, now);
          connection.sqlite
            .prepare("insert into highlights (id, memory_id, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run("highlight-old", "018f04a2-3c6f-7c88-9a8b-8c99a9b7f202", "older text", "old before", "old after", 4, 14, older, older);

          const rows = await connection.repositories.highlights.listForBrowse();
          process.stdout.write(JSON.stringify(rows));
        } finally {
          connection.close();
        }
      `,
      { TRAUMA_TEST_ROOT: root },
    );

    const rows = JSON.parse(output);
    expect(rows).toEqual([
      {
        id: "highlight-new",
        memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f201",
        memoryTitle: "Source Memory",
        text: "selected text",
        prefix: "before",
        suffix: "after",
        startOffset: 8,
        endOffset: 21,
        createdAt: "2026-05-10T01:00:00.000Z",
      },
      {
        id: "highlight-old",
        memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f202",
        memoryTitle: "Older Source",
        text: "older text",
        prefix: "old before",
        suffix: "old after",
        startOffset: 4,
        endOffset: 14,
        createdAt: "2026-05-09T01:00:00.000Z",
      },
    ]);
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
    throw new Error("Bun executable is required for highlight repository tests");
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

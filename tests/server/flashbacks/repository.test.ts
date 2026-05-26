import { execFileSync } from "node:child_process";
import { accessSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

describe("flashback repository", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lists flashback browse rows with source memory title and context", () => {
    const root = createTempRoot(tempRoots);
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
            .prepare("insert into flashbacks (id, memory_id, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run("flashback-new", "018f04a2-3c6f-7c88-9a8b-8c99a9b7f201", "selected text", "before", "after", 8, 21, now, now);
          connection.sqlite
            .prepare("insert into flashbacks (id, memory_id, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run("flashback-old", "018f04a2-3c6f-7c88-9a8b-8c99a9b7f202", "older text", "old before", "old after", 4, 14, older, older);

          const rows = await connection.repositories.flashbacks.listForBrowse();
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
        id: "flashback-new",
        memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f201",
        memoryTitle: "Source Memory",
        text: "selected text",
        prefix: "before",
        suffix: "after",
        startOffset: 8,
        endOffset: 21,
        contentHash: null,
        variantKind: "source",
        langCode: null,
        translationOutputHash: null,
        createdAt: "2026-05-10T01:00:00.000Z",
      },
      {
        id: "flashback-old",
        memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f202",
        memoryTitle: "Older Source",
        text: "older text",
        prefix: "old before",
        suffix: "old after",
        startOffset: 4,
        endOffset: 14,
        contentHash: null,
        variantKind: "source",
        langCode: null,
        translationOutputHash: null,
        createdAt: "2026-05-09T01:00:00.000Z",
      },
    ]);
  });

  it("lists source and translated flashbacks for global browse with variant identity", () => {
    const root = createTempRoot(tempRoots);
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f205";
        const now = Date.parse("2026-05-10T01:00:00.000Z");
        const older = Date.parse("2026-05-09T01:00:00.000Z");
        const outputHash = "sha256:" + "a".repeat(64);
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
              memoryId,
              "https://example.com/" + memoryId,
              "Variant Browse",
              null,
              "memories/" + memoryId + "/CONTENT.md",
              "success",
              "disabled",
              older,
              older,
            );

          connection.sqlite
            .prepare("insert into flashbacks (id, memory_id, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run("source-old", memoryId, "source text", "", "", 0, 11, older, older);
          connection.sqlite
            .prepare("insert into flashbacks (id, memory_id, variant_kind, lang_code, translation_output_hash, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run("translated-new", memoryId, "translation", "ja-JP", outputHash, "translated text", "", "", 0, 15, now, now);

          const rows = await connection.repositories.flashbacks.listForBrowse();
          process.stdout.write(JSON.stringify(rows));
        } finally {
          connection.close();
        }
      `,
      { TRAUMA_TEST_ROOT: root },
    );

    expect(JSON.parse(output)).toEqual([
      expect.objectContaining({
        id: "translated-new",
        memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f205",
        memoryTitle: "Variant Browse",
        variantKind: "translation",
        langCode: "ja-JP",
        translationOutputHash: "sha256:" + "a".repeat(64),
      }),
      expect.objectContaining({
        id: "source-old",
        memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f205",
        memoryTitle: "Variant Browse",
        variantKind: "source",
        langCode: null,
        translationOutputHash: null,
      }),
    ]);
  });

  it("replaces source flashbacks without deleting translated variants", () => {
    const root = createTempRoot(tempRoots);
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f203";
        const now = new Date("2026-05-10T01:00:00.000Z");
        const outputHash = "sha256:" + "a".repeat(64);
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
              memoryId,
              "https://example.com/" + memoryId,
              "Variant Source",
              null,
              "memories/" + memoryId + "/CONTENT.md",
              "success",
              "disabled",
              now.getTime(),
              now.getTime(),
            );

          connection.sqlite
            .prepare("insert into flashbacks (id, memory_id, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run("source-existing", memoryId, "source old", "", "", 0, 10, now.getTime(), now.getTime());
          connection.sqlite
            .prepare("insert into flashbacks (id, memory_id, variant_kind, lang_code, translation_output_hash, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run("translated-existing", memoryId, "translation", "ja-JP", outputHash, "translated old", "", "", 0, 14, now.getTime(), now.getTime());

          await connection.repositories.flashbacks.replaceForMemoryVariant({
            memoryId,
            variant: { kind: "source" },
            flashbacks: [{
              id: "source-new",
              memoryId,
              variantKind: "source",
              langCode: null,
              translationOutputHash: null,
              text: "source new",
              prefix: "",
              suffix: "",
              startOffset: 0,
              endOffset: 10,
              contentHash: null,
              createdAt: now,
              updatedAt: now,
            }],
          });

          const rows = connection.sqlite
            .prepare("select id, variant_kind as variantKind, lang_code as langCode, translation_output_hash as translationOutputHash from flashbacks order by id")
            .all();
          process.stdout.write(JSON.stringify(rows));
        } finally {
          connection.close();
        }
      `,
      { TRAUMA_TEST_ROOT: root },
    );

    expect(JSON.parse(output)).toEqual([
      {
        id: "source-new",
        variantKind: "source",
        langCode: null,
        translationOutputHash: null,
      },
      {
        id: "translated-existing",
        variantKind: "translation",
        langCode: "ja-JP",
        translationOutputHash: "sha256:" + "a".repeat(64),
      },
    ]);
  });

  it("replaces only the requested translated output hash variant", () => {
    const root = createTempRoot(tempRoots);
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f204";
        const now = new Date("2026-05-10T01:00:00.000Z");
        const hashA = "sha256:" + "a".repeat(64);
        const hashB = "sha256:" + "b".repeat(64);
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
              memoryId,
              "https://example.com/" + memoryId,
              "Variant Translation",
              null,
              "memories/" + memoryId + "/CONTENT.md",
              "success",
              "disabled",
              now.getTime(),
              now.getTime(),
            );

          for (const [id, hash] of [["translated-existing-a", hashA], ["translated-existing-b", hashB]]) {
            connection.sqlite
              .prepare("insert into flashbacks (id, memory_id, variant_kind, lang_code, translation_output_hash, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .run(id, memoryId, "translation", "ja-JP", hash, id, "", "", 0, id.length, now.getTime(), now.getTime());
          }

          await connection.repositories.flashbacks.replaceForMemoryVariant({
            memoryId,
            variant: { kind: "translation", langCode: "ja-JP", outputHash: hashA },
            flashbacks: [{
              id: "translated-new-a",
              memoryId,
              variantKind: "translation",
              langCode: "ja-JP",
              translationOutputHash: hashA,
              text: "translated new a",
              prefix: "",
              suffix: "",
              startOffset: 0,
              endOffset: 16,
              contentHash: null,
              createdAt: now,
              updatedAt: now,
            }],
          });

          const rows = connection.sqlite
            .prepare("select id, translation_output_hash as translationOutputHash from flashbacks order by id")
            .all();
          process.stdout.write(JSON.stringify(rows));
        } finally {
          connection.close();
        }
      `,
      { TRAUMA_TEST_ROOT: root },
    );

    expect(JSON.parse(output)).toEqual([
      {
        id: "translated-existing-b",
        translationOutputHash: "sha256:" + "b".repeat(64),
      },
      {
        id: "translated-new-a",
        translationOutputHash: "sha256:" + "a".repeat(64),
      },
    ]);
  });

  it("rejects replacement rows for a different memory", () => {
    const root = createTempRoot(tempRoots);
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f201";
        const otherMemoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f202";
        const now = new Date("2026-05-10T01:00:00.000Z");
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
          for (const id of [memoryId, otherMemoryId]) {
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
                id,
                "https://example.com/" + id,
                "Source " + id,
                null,
                "memories/" + id + "/CONTENT.md",
                "success",
                "disabled",
                now.getTime(),
                now.getTime(),
              );
          }

          let error;
          try {
            await connection.repositories.flashbacks.replaceForMemory(memoryId, [
              {
                id: "cross-memory-flashback",
                memoryId: otherMemoryId,
                text: "selected text",
                prefix: "",
                suffix: "",
                startOffset: 0,
                endOffset: 13,
                createdAt: now,
                updatedAt: now,
              },
            ]);
          } catch (caught) {
            error = {
              name: caught.name,
              message: caught.message,
            };
          }

          const rows = connection.sqlite
            .prepare("select id, memory_id as memoryId from flashbacks order by id")
            .all();
          process.stdout.write(JSON.stringify({ error, rows }));
        } finally {
          connection.close();
        }
      `,
      { TRAUMA_TEST_ROOT: root },
    );

    const result = JSON.parse(output);
    expect(result).toEqual({
      error: {
        name: "MemoryRepositoryError",
        message:
          "Cannot replace flashbacks for one memory variant with rows from another memory variant.",
      },
      rows: [],
    });
  });
});

function createTempRoot(tempRoots: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "trauma-flashbacks-"));
  tempRoots.push(root);
  return root;
}

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
    throw new Error("Bun executable is required for flashback repository tests");
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

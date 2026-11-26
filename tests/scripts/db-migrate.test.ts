import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";

interface PackageJson {
  scripts: Record<string, string>;
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;

describe("db:migrate command", () => {
  it("uses Trauma's config-aware runtime migration entrypoint", () => {
    expect(packageJson.scripts["db:migrate"]).toBe(
      "bun run scripts/migrate-database.ts",
    );
  });

  it("fails closed when the requested runtime config is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-migrate-"));
    const missingConfigPath = join(root, "missing.config.json");

    const result = runDatabaseMigration(missingConfigPath);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`Missing trauma config at ${missingConfigPath}`);
    expect(result.stderr).not.toContain(".trauma/trauma.sqlite");
  });

  it("rejects tampered migration history through the checked runtime runner", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-migrate-"));
    const configPath = writeRuntimeConfig(root);
    const databasePath = join(root, "runtime", "trauma.sqlite");

    const initial = runDatabaseMigration(configPath);
    expect(initial.status).toBe(0);
    expect(initial.stdout).toContain(
      `Applied runtime migrations to ${databasePath}`,
    );

    const database = new Database(databasePath);
    try {
      database
        .prepare(
          "update __drizzle_migrations set hash = ? where created_at = ?",
        )
        .run("tampered", 1778393646543);
    } finally {
      database.close();
    }

    const rerun = runDatabaseMigration(configPath);

    expect(rerun.status).not.toBe(0);
    expect(rerun.stderr).toContain("bundled migration hash mismatch");
  });

  it("backfills NULL word_count rows from stored CONTENT.md and reports counts on stdout", () => {
    const root = mkdtempSync(join(tmpdir(), "trauma-db-migrate-"));
    try {
      const configPath = writeRuntimeConfig(root);
      const databasePath = join(root, "runtime", "trauma.sqlite");
      const storePath = join(root, "data", "store");

      const initial = runDatabaseMigration(configPath);
      expect(initial.status).toBe(0);
      expect(initial.stdout).toContain(
        `Applied runtime migrations to ${databasePath}`,
      );
      expect(initial.stdout).toContain("word_count filled 0, skipped 0, errored 0");

      const filledId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f601";
      const missingId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f602";
      const originalUpdatedAt = Date.parse("2026-05-09T01:23:45.000Z");

      const database = new Database(databasePath);
      try {
        const insertMemory = database.prepare(
          `INSERT INTO memories (
            id, url, title, description, content_path, extraction_status,
            word_count, backup_status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        insertMemory.run(
          filledId,
          "https://example.com/backfill-word-count",
          "Japanese Article",
          null,
          `memories/${filledId}/CONTENT.md`,
          "success",
          null,
          "disabled",
          originalUpdatedAt,
          originalUpdatedAt,
        );
        insertMemory.run(
          missingId,
          "https://example.com/missing-word-count",
          "Missing Content",
          null,
          `memories/${missingId}/CONTENT.md`,
          "success",
          null,
          "disabled",
          originalUpdatedAt + 1000,
          originalUpdatedAt + 1000,
        );
      } finally {
        database.close();
      }

      const contentDir = join(storePath, "memories", filledId);
      mkdirSync(contentDir, { recursive: true });
      writeFileSync(
        join(contentDir, "CONTENT.md"),
        [
          "---",
          `id: "${filledId}"`,
          'url: "https://example.com/backfill-word-count"',
          'title: "Frontmatter Excluded"',
          'captured_at: "2026-05-09T01:23:45.000Z"',
          'extraction_status: "success"',
          "---",
          "日本語の文章です",
        ].join("\n"),
        "utf8",
      );

      const backfillRun = runDatabaseMigration(configPath);
      expect(backfillRun.status).toBe(0);
      expect(backfillRun.stdout).toContain(
        `Applied runtime migrations to ${databasePath}`,
      );
      expect(backfillRun.stdout).toContain("word_count filled 1, skipped 1, errored 0");

      const verifyDb = new Database(databasePath, { readonly: true });
      try {
        const filledRow = verifyDb
          .query<
            { wordCount: number | null; updatedAt: number },
            [string]
          >("SELECT word_count AS wordCount, updated_at AS updatedAt FROM memories WHERE id = ?")
          .get(filledId);
        const missingRow = verifyDb
          .query<{ wordCount: number | null }, [string]>(
            "SELECT word_count AS wordCount FROM memories WHERE id = ?",
          )
          .get(missingId);

        expect(filledRow).toEqual({
          wordCount: 8,
          updatedAt: originalUpdatedAt,
        });
        expect(missingRow).toEqual({ wordCount: null });
      } finally {
        verifyDb.close();
      }

      const idempotentRun = runDatabaseMigration(configPath);
      expect(idempotentRun.status).toBe(0);
      expect(idempotentRun.stdout).toContain("word_count filled 0, skipped 1, errored 0");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function writeRuntimeConfig(root: string) {
  const configPath = join(root, "trauma.config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      projectPath: "./data",
      storePath: "./data/store",
      databasePath: "./runtime/trauma.sqlite",
      backup: {
        git: {
          enabled: false,
          remote: "origin",
          branch: "main",
          push: false,
          commitMessageTemplate: "backup {action} {memoryId}",
        },
      },
    }),
  );
  return configPath;
}

function runDatabaseMigration(configPath: string) {
  const result = spawnSync(
    "bun",
    ["run", "db:migrate", "--config", configPath],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        TRAUMA_CONFIG_PATH: undefined,
        TRAUMA_DATABASE_PATH: undefined,
      },
    },
  );

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

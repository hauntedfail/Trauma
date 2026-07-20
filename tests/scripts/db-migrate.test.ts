import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

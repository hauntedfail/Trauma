import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runBackupFailsafeCli } from "../../../scripts/trauma-backup-failsafe";
import { loadTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";

const tempDirs: string[] = [];
const now = new Date("2026-05-13T00:00:00.000Z");

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("backup failsafe CLI", () => {
  it("prints active status as JSON", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    await mkdir(join(root, "old-data/storage/memories/memory-1"), {
      recursive: true,
    });
    await writeFile(
      join(root, "old-data/storage/memories/memory-1/CONTENT.md"),
      "# Old\n",
      "utf8",
    );
    await seedPathDriftAlert(configPath, root);

    const output = await runBackupFailsafeCli([
      "status",
      "--config",
      configPath,
    ]);

    expect(JSON.parse(output)).toMatchObject({
      kind: "backup_path_drift",
      previousStorePath: join(root, "old-data/storage"),
      currentStorePath: join(root, "new-data/storage"),
    });
  });

  it("prints a dry-run revert summary by default and requires --apply to edit config", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    await seedPathDriftAlert(configPath, root);

    const output = await runBackupFailsafeCli([
      "revert",
      "--config",
      configPath,
    ]);

    expect(output).toContain("DRY RUN");
    expect(output).toContain("Revert config");
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
      projectPath: "./new-data",
      storePath: "./new-data/storage",
    });
  });

  it("applies migration without overwriting conflicting target content", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    const oldStore = join(root, "old-data/storage");
    const newStore = join(root, "new-data/storage");
    await mkdir(join(oldStore, "memories", "memory-1"), { recursive: true });
    await mkdir(join(newStore, "memories", "memory-1"), { recursive: true });
    await writeFile(join(oldStore, "memories/memory-1/CONTENT.md"), "# Old\n", "utf8");
    await writeFile(join(newStore, "memories/memory-1/CONTENT.md"), "# Existing\n", "utf8");
    await seedPathDriftAlert(configPath, root);

    await expect(
      runBackupFailsafeCli(["migrate", "--config", configPath, "--apply"]),
    ).rejects.toThrow(/refusing to overwrite existing backup content/);
  });

  it("retries migration when copied target content already matches the source", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    const oldStore = join(root, "old-data/storage");
    const newStore = join(root, "new-data/storage");
    const relativeContent = "memories/memory-1/CONTENT.md";
    await mkdir(join(oldStore, "memories", "memory-1"), { recursive: true });
    await mkdir(join(newStore, "memories", "memory-1"), { recursive: true });
    await writeFile(join(oldStore, relativeContent), "# Old\n", "utf8");
    await writeFile(join(newStore, relativeContent), "# Old\n", "utf8");
    await seedPathDriftAlert(configPath, root);

    const output = await withGitIdentity(() =>
      runBackupFailsafeCli(["migrate", "--config", configPath, "--apply"]),
    );

    expect(output).toContain("APPLY: Migrate backup");
    expect(output).toContain("Alert cleared.");
    const config = loadTraumaConfig({ configPath });
    expect(git(config.projectPath, ["status", "--short"]).trim()).toBe("");
    expect(
      git(config.projectPath, ["show", "--name-only", "--pretty=format:", "HEAD"])
        .trim()
        .split(/\r?\n/)
        .filter(Boolean),
    ).toEqual(["storage/memories/memory-1/CONTENT.md"]);
  });

  it("applies migration by copying content, initializing the target repo, and clearing the alert", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    const oldStore = join(root, "old-data/storage");
    const targetContent = join(
      root,
      "new-data/storage/memories/memory-1/CONTENT.md",
    );
    await mkdir(join(oldStore, "memories", "memory-1"), { recursive: true });
    await writeFile(join(oldStore, "memories/memory-1/CONTENT.md"), "# Old\n", "utf8");
    await seedPathDriftAlert(configPath, root);

    const output = await withGitIdentity(() =>
      runBackupFailsafeCli([
        "migrate",
        "--config",
        configPath,
        "--apply",
      ]),
    );

    expect(output).toContain("APPLY: Migrate backup");
    expect(output).toContain("Alert cleared.");
    expect(await readFile(targetContent, "utf8")).toBe("# Old\n");

    const config = loadTraumaConfig({ configPath });
    const connection = initializeDatabase(config);
    try {
      expect(await connection.repositories.backupEnvironment.getBackupFailsafeAlert())
        .toBeUndefined();
      expect(await connection.repositories.backupEnvironment.getBackupEnvironmentStamp())
        .toMatchObject({
          projectPath: join(root, "new-data"),
          storePath: join(root, "new-data/storage"),
        });
    } finally {
      connection.close();
    }
    expect(git(config.projectPath, ["log", "-1", "--pretty=%s"]).trim()).toBe(
      "backup migrated memory content",
    );
    expect(
      git(config.projectPath, ["show", "--name-only", "--pretty=format:", "HEAD"])
        .trim()
        .split(/\r?\n/)
        .filter(Boolean),
    ).toEqual(["storage/memories/memory-1/CONTENT.md"]);
    expect(git(config.projectPath, ["status", "--short"]).trim()).toBe("");
  });

  it("pushes migrated backup commits before clearing a path-drift alert", async () => {
    const root = await makeRoot();
    const remotePath = join(root, "remote.git");
    const configPath = await writeConfig(root, { push: true });
    const config = loadTraumaConfig({ configPath });
    const oldStore = join(root, "old-data/storage");
    await mkdir(join(oldStore, "memories", "memory-1"), { recursive: true });
    await writeFile(join(oldStore, "memories/memory-1/CONTENT.md"), "# Old\n", "utf8");
    git(root, ["init", "--bare", remotePath]);
    await mkdir(config.projectPath, { recursive: true });
    git(config.projectPath, ["init", "--initial-branch=main"]);
    git(config.projectPath, ["remote", "add", "origin", remotePath]);
    await seedPathDriftAlert(configPath, root);

    await withGitIdentity(() =>
      runBackupFailsafeCli(["migrate", "--config", configPath, "--apply"]),
    );

    expect(hasRemoteMain(remotePath)).toBe(true);
    expect(
      git(remotePath, ["show", "--name-only", "--pretty=format:", "main"])
        .trim()
        .split(/\r?\n/)
        .filter(Boolean),
    ).toEqual(["storage/memories/memory-1/CONTENT.md"]);
  });

  it("records a push-failure alert when migrated backup content cannot be pushed", async () => {
    const root = await makeRoot();
    const missingRemotePath = join(root, "missing.git");
    const configPath = await writeConfig(root, { push: true });
    const config = loadTraumaConfig({ configPath });
    const oldStore = join(root, "old-data/storage");
    await mkdir(join(oldStore, "memories", "memory-1"), { recursive: true });
    await writeFile(join(oldStore, "memories/memory-1/CONTENT.md"), "# Old\n", "utf8");
    await mkdir(config.projectPath, { recursive: true });
    git(config.projectPath, ["init", "--initial-branch=main"]);
    git(config.projectPath, ["remote", "add", "origin", missingRemotePath]);
    await seedPathDriftAlert(configPath, root);

    await expect(
      withGitIdentity(() =>
        runBackupFailsafeCli(["migrate", "--config", configPath, "--apply"]),
      ),
    ).rejects.toThrow(/git push failed/);

    const connection = initializeDatabase(config);
    try {
      expect(await connection.repositories.backupEnvironment.getBackupFailsafeAlert())
        .toMatchObject({
          kind: "backup_push_failed",
          currentProjectPath: config.projectPath,
          currentStorePath: config.storePath,
        });
      expect(await connection.repositories.backupEnvironment.getBackupEnvironmentStamp())
        .toMatchObject({
          projectPath: config.projectPath,
          storePath: config.storePath,
        });
    } finally {
      connection.close();
    }
  });

  it("does not treat unreadable source directories as an empty migration", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    const oldMemories = join(root, "old-data/storage/memories");
    await mkdir(oldMemories, { recursive: true });
    await chmod(oldMemories, 0);
    await seedPathDriftAlert(configPath, root);

    try {
      await expect(
        runBackupFailsafeCli(["migrate", "--config", configPath, "--apply"]),
      ).rejects.toMatchObject({ code: "EACCES" });
    } finally {
      await chmod(oldMemories, 0o700);
    }
  });

  it("accepts current backup paths by committing existing store content when data has no previous stamp", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    const config = loadTraumaConfig({ configPath });
    await mkdir(join(config.storePath, "memories", "memory-1"), {
      recursive: true,
    });
    await writeFile(join(config.storePath, "memories/memory-1/CONTENT.md"), "# Current\n", "utf8");
    await seedUnstampedCurrentDataAlert(configPath);

    const output = await withGitIdentity(() =>
      runBackupFailsafeCli([
        "migrate",
        "--config",
        configPath,
        "--apply",
      ]),
    );

    expect(output).toContain("APPLY: Accept current backup location");
    expect(output).toContain("Alert cleared.");
    const connection = initializeDatabase(config);
    try {
      expect(await connection.repositories.backupEnvironment.getBackupFailsafeAlert())
        .toBeUndefined();
      expect(await connection.repositories.backupEnvironment.getBackupEnvironmentStamp())
        .toMatchObject({
          projectPath: config.projectPath,
          storePath: config.storePath,
        });
    } finally {
      connection.close();
    }
    expect(git(config.projectPath, ["log", "-1", "--pretty=%s"]).trim()).toBe(
      "backup migrated memory content",
    );
    expect(
      git(config.projectPath, ["show", "--name-only", "--pretty=format:", "HEAD"])
        .trim()
        .split(/\r?\n/)
        .filter(Boolean),
    ).toEqual(["storage/memories/memory-1/CONTENT.md"]);
    expect(git(config.projectPath, ["status", "--short"]).trim()).toBe("");
  });

  it("does not accept current paths for non-path-drift alerts", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    await seedPushFailureAlert(configPath);

    await expect(
      runBackupFailsafeCli(["migrate", "--config", configPath, "--apply"]),
    ).rejects.toThrow(/cannot accept current backup paths/);

    const config = loadTraumaConfig({ configPath });
    const connection = initializeDatabase(config);
    try {
      expect(await connection.repositories.backupEnvironment.getBackupFailsafeAlert())
        .toMatchObject({ kind: "backup_push_failed" });
    } finally {
      connection.close();
    }
  });
});

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "trauma-backup-cli-"));
  tempDirs.push(root);
  return root;
}

async function writeConfig(root: string, options: { push?: boolean } = {}) {
  const configPath = join(root, "trauma.config.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        projectPath: "./new-data",
        storePath: "./new-data/storage",
        databasePath: "./.trauma/trauma.sqlite",
        backup: {
          git: {
            enabled: true,
            remote: "origin",
            branch: "main",
            push: options.push ?? false,
            commitMessageTemplate: "backup memory {memoryId}",
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  return configPath;
}

async function seedPathDriftAlert(configPath: string, root: string) {
  const config = loadTraumaConfig({ configPath });
  const connection = initializeDatabase(config);
  try {
    await connection.repositories.backupEnvironment.upsertBackupEnvironmentStamp({
      id: "default",
      projectPath: join(root, "old-data"),
      storePath: join(root, "old-data/storage"),
      gitRemote: "origin",
      gitRemoteUrl: null,
      gitBranch: "main",
      createdAt: now,
      updatedAt: now,
    });
    await connection.repositories.backupEnvironment.upsertBackupFailsafeAlert({
      id: "active",
      kind: "backup_path_drift",
      severity: "critical",
      message: "Backup location changed",
      previousProjectPath: join(root, "old-data"),
      previousStorePath: join(root, "old-data/storage"),
      currentProjectPath: config.projectPath,
      currentStorePath: config.storePath,
      gitRemote: "origin",
      gitRemoteUrl: null,
      gitBranch: "main",
      error: null,
      createdAt: now,
      updatedAt: now,
    });
  } finally {
    connection.close();
  }
}

async function seedUnstampedCurrentDataAlert(configPath: string) {
  const config = loadTraumaConfig({ configPath });
  const connection = initializeDatabase(config);
  try {
    await connection.repositories.backupEnvironment.upsertBackupFailsafeAlert({
      id: "active",
      kind: "backup_path_drift",
      severity: "critical",
      message: "Backup location changed",
      previousProjectPath: null,
      previousStorePath: null,
      currentProjectPath: config.projectPath,
      currentStorePath: config.storePath,
      gitRemote: "origin",
      gitRemoteUrl: null,
      gitBranch: "main",
      error: null,
      createdAt: now,
      updatedAt: now,
    });
  } finally {
    connection.close();
  }
}

async function seedPushFailureAlert(configPath: string) {
  const config = loadTraumaConfig({ configPath });
  const connection = initializeDatabase(config);
  try {
    await connection.repositories.backupEnvironment.upsertBackupFailsafeAlert({
      id: "active",
      kind: "backup_push_failed",
      severity: "critical",
      message: "Backup push failed",
      previousProjectPath: null,
      previousStorePath: null,
      currentProjectPath: config.projectPath,
      currentStorePath: config.storePath,
      gitRemote: "origin",
      gitRemoteUrl: null,
      gitBranch: "main",
      error: "remote unavailable",
      createdAt: now,
      updatedAt: now,
    });
  } finally {
    connection.close();
  }
}

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: createGitCommandEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function hasRemoteMain(remotePath: string) {
  try {
    git(remotePath, ["rev-parse", "--verify", "refs/heads/main"]);
    return true;
  } catch {
    return false;
  }
}

function createGitCommandEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}

async function withGitIdentity<T>(run: () => Promise<T>): Promise<T> {
  const keys = [
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
  ] as const;
  const previous = new Map<string, string | undefined>();
  for (const key of keys) {
    previous.set(key, process.env[key]);
  }

  process.env.GIT_AUTHOR_NAME = "Trauma Tests";
  process.env.GIT_AUTHOR_EMAIL = "trauma@example.invalid";
  process.env.GIT_COMMITTER_NAME = "Trauma Tests";
  process.env.GIT_COMMITTER_EMAIL = "trauma@example.invalid";

  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }
      process.env[key] = value;
    }
  }
}

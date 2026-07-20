import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  formatBackupFailsafeDryRunApproval,
  runBackupFailsafeCli as runRawBackupFailsafeCli,
} from "../../../scripts/trauma-backup-failsafe";
import { acquireBackupFailsafeActionLease } from "../../../src/server/backup/failsafe-action-coordination";
import {
  migrateBackupFailsafeContent,
  readActiveBackupFailsafeAlert,
} from "../../../src/server/backup/failsafe";
import { loadTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";
import {
  ensureBackupEnvironment,
  fingerprintGitRemote,
} from "../../../src/server/backup/environment";

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
      generation: expect.stringMatching(/^[a-f0-9]{64}$/u),
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
    expect(output).toMatch(/generation: [a-f0-9]{64}/u);
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
      projectPath: "./new-data",
      storePath: "./new-data/storage",
    });
  });

  it("keeps a dry-run summary bound to its reviewed generation when the alert changes before formatting", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    const oldStorePath = join(root, "old-data/storage");
    await mkdir(join(oldStorePath, "memories/memory-1"), { recursive: true });
    await writeFile(
      join(oldStorePath, "memories/memory-1/CONTENT.md"),
      "# Reviewed\n",
      "utf8",
    );
    await seedPathDriftAlert(configPath, root);

    const config = loadTraumaConfig({ configPath });
    const connection = initializeDatabase(config);
    try {
      const reviewed = await migrateBackupFailsafeContent({
        config,
        db: connection.db,
        apply: false,
      });
      const originalAlert =
        await connection.repositories.backupEnvironment.getBackupFailsafeAlert();
      expect(originalAlert).toBeDefined();

      const replacementProjectPath = join(root, "replacement-data");
      const replacementStorePath = join(replacementProjectPath, "storage");
      await connection.repositories.backupEnvironment.upsertBackupFailsafeAlert({
        ...originalAlert!,
        previousProjectPath: replacementProjectPath,
        previousStorePath: replacementStorePath,
        updatedAt: new Date(now.getTime() + 1_000),
      });
      const replacement = await readActiveBackupFailsafeAlert(connection.db);
      expect(replacement).not.toBeNull();
      expect(replacement!.generation).not.toBe(reviewed.generation);

      const output = formatBackupFailsafeDryRunApproval(reviewed);
      expect(output).toContain(`from: ${oldStorePath}`);
      expect(output).toContain(`generation: ${reviewed.generation}`);
      expect(output).not.toContain(replacement!.generation);
      expect(output).not.toContain(replacementStorePath);
    } finally {
      connection.close();
    }
  });

  it("requires the dry-run alert generation when applying", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    await seedPathDriftAlert(configPath, root);

    await expect(
      runRawBackupFailsafeCli([
        "revert",
        "--config",
        configPath,
        "--apply",
      ]),
    ).rejects.toThrow("--generation is required with --apply");
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

  it("excludes operation journals and delete staging from migrated backup content", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    const oldStore = join(root, "old-data/storage");
    const canonicalPath = "memories/memory-1/CONTENT.md";
    await mkdir(join(oldStore, "memories/memory-1"), { recursive: true });
    await mkdir(join(oldStore, ".operations"), { recursive: true });
    await mkdir(join(oldStore, ".delete-staging/memory-1"), { recursive: true });
    await mkdir(join(oldStore, ".git/objects"), { recursive: true });
    await writeFile(join(oldStore, canonicalPath), "# Canonical\n", "utf8");
    await writeFile(join(oldStore, ".operations/memory-1.json"), "{\"state\":\"deleting\"}\n", "utf8");
    await writeFile(
      join(oldStore, ".delete-staging/memory-1/CONTENT.md"),
      "# Deleted transient content\n",
      "utf8",
    );
    await writeFile(join(oldStore, ".git/objects/private"), "git internals", "utf8");
    await seedPathDriftAlert(configPath, root);

    const output = await withGitIdentity(() =>
      runBackupFailsafeCli(["migrate", "--config", configPath, "--apply"]),
    );

    expect(output).toContain("files: 1");
    const config = loadTraumaConfig({ configPath });
    await expect(readFile(join(config.storePath, canonicalPath), "utf8"))
      .resolves.toBe("# Canonical\n");
    await expect(readFile(join(config.storePath, ".operations/memory-1.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(
      join(config.storePath, ".delete-staging/memory-1/CONTENT.md"),
      "utf8",
    )).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(config.storePath, ".git/objects/private"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(
      git(config.projectPath, ["show", "--name-only", "--pretty=format:", "HEAD"])
        .trim()
        .split(/\r?\n/)
        .filter(Boolean),
    ).toEqual(["storage/memories/memory-1/CONTENT.md"]);
  });

  it("rejects overlapping previous and current migration topologies before traversal", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    await seedPathDriftAlert(configPath, root, {
      previousProjectPath: root,
      previousStorePath: root,
    });

    await expect(
      runBackupFailsafeCli(["migrate", "--config", configPath]),
    ).rejects.toThrow(/previous and current backup paths overlap/);
  });

  it("validates the repository branch before staging recovery content", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    const config = loadTraumaConfig({ configPath });
    const oldStore = join(root, "old-data/storage");
    await mkdir(join(oldStore, "memories/memory-1"), { recursive: true });
    await writeFile(
      join(oldStore, "memories/memory-1/CONTENT.md"),
      "# Old\n",
      "utf8",
    );
    await mkdir(config.projectPath, { recursive: true });
    git(config.projectPath, ["init", "--initial-branch=unexpected"]);
    await seedPathDriftAlert(configPath, root);

    await expect(
      runBackupFailsafeCli(["migrate", "--config", configPath, "--apply"]),
    ).rejects.toThrow(/does not match configured branch main/);
    expect(git(config.projectPath, ["status", "--short"]).trim()).toBe("");
    await expect(readFile(
      join(config.storePath, "memories/memory-1/CONTENT.md"),
      "utf8",
    )).rejects.toMatchObject({ code: "ENOENT" });
    expect(() => git(config.projectPath, ["rev-parse", "--verify", "HEAD"]))
      .toThrow();
  });

  it("rejects a changed migration remote before copying or staging", async () => {
    const root = await makeRoot();
    const firstRemote = join(root, "first.git");
    const secondRemote = join(root, "second.git");
    const configPath = await writeConfig(root);
    const config = loadTraumaConfig({ configPath });
    const oldStore = join(root, "old-data/storage");
    await mkdir(join(oldStore, "memories/memory-1"), { recursive: true });
    await writeFile(
      join(oldStore, "memories/memory-1/CONTENT.md"),
      "# Old\n",
      "utf8",
    );
    await mkdir(config.projectPath, { recursive: true });
    git(config.projectPath, ["init", "--initial-branch=main"]);
    git(config.projectPath, ["remote", "add", "origin", firstRemote]);
    await seedPathDriftAlert(configPath, root);
    git(config.projectPath, ["remote", "set-url", "origin", secondRemote]);

    await expect(
      runBackupFailsafeCli(["migrate", "--config", configPath, "--apply"]),
    ).rejects.toThrow(/alert changed/);
    await expect(readFile(
      join(config.storePath, "memories/memory-1/CONTENT.md"),
      "utf8",
    )).rejects.toMatchObject({ code: "ENOENT" });
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

  it("does not execute ambient hooks during failsafe migration commit and push", async () => {
    const root = await makeRoot();
    const remotePath = join(root, "remote.git");
    const hooksPath = join(root, "ambient-hooks");
    const markerPath = join(root, "ambient-hooks-ran");
    const globalConfigPath = join(root, "global.gitconfig");
    const configPath = await writeConfig(root, { push: true });
    const config = loadTraumaConfig({ configPath });
    const oldStore = join(root, "old-data/storage");
    await mkdir(join(oldStore, "memories", "memory-1"), { recursive: true });
    await writeFile(join(oldStore, "memories/memory-1/CONTENT.md"), "# Old\n", "utf8");
    git(root, ["init", "--bare", remotePath]);
    await mkdir(config.projectPath, { recursive: true });
    git(config.projectPath, ["init", "--initial-branch=main"]);
    git(config.projectPath, ["remote", "add", "origin", remotePath]);
    await installExecutableGitHooks({
      hooks: ["pre-commit", "commit-msg", "post-commit", "pre-push"],
      hooksPath,
      markerPath,
    });
    git(root, [
      "config",
      "--file",
      globalConfigPath,
      "core.hooksPath",
      hooksPath,
    ]);
    await seedPathDriftAlert(configPath, root);

    await withGlobalGitConfig(globalConfigPath, () =>
      withGitIdentity(() =>
        runBackupFailsafeCli(["migrate", "--config", configPath, "--apply"]),
      )
    );

    await expect(readFile(markerPath, "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(hasRemoteMain(remotePath)).toBe(true);
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
          projectPath: join(root, "old-data"),
          storePath: join(root, "old-data/storage"),
        });
      await expect(
        ensureBackupEnvironment({ config, db: connection.db }),
      ).resolves.toMatchObject({
        ok: false,
        alert: { kind: "backup_push_failed" },
      });
    } finally {
      connection.close();
    }
  });

  it("retries migrated backup push failures after the remote is repaired", async () => {
    const root = await makeRoot();
    const remotePath = join(root, "remote.git");
    const configPath = await writeConfig(root, { push: true });
    const config = loadTraumaConfig({ configPath });
    const oldStore = join(root, "old-data/storage");
    await mkdir(join(oldStore, "memories", "memory-1"), { recursive: true });
    await writeFile(join(oldStore, "memories/memory-1/CONTENT.md"), "# Old\n", "utf8");
    await mkdir(config.projectPath, { recursive: true });
    git(config.projectPath, ["init", "--initial-branch=main"]);
    git(config.projectPath, ["remote", "add", "origin", remotePath]);
    await seedPathDriftAlert(configPath, root);

    await expect(
      withGitIdentity(() =>
        runBackupFailsafeCli(["migrate", "--config", configPath, "--apply"]),
      ),
    ).rejects.toThrow(/git push failed/);

    git(root, ["init", "--bare", remotePath]);
    const hooksPath = join(root, "ambient-hooks");
    const markerPath = join(root, "ambient-hooks-ran");
    const globalConfigPath = join(root, "global.gitconfig");
    await installExecutableGitHooks({
      hooks: ["pre-push"],
      hooksPath,
      markerPath,
    });
    git(root, [
      "config",
      "--file",
      globalConfigPath,
      "core.hooksPath",
      hooksPath,
    ]);
    const output = await withGlobalGitConfig(globalConfigPath, () =>
      withGitIdentity(() =>
        runBackupFailsafeCli(["migrate", "--config", configPath, "--apply"]),
      )
    );

    expect(output).toContain("APPLY: Retry backup push");
    expect(output).toContain("Alert cleared.");
    await expect(readFile(markerPath, "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(hasRemoteMain(remotePath)).toBe(true);
    expect(
      git(remotePath, ["show", "--name-only", "--pretty=format:", "main"])
        .trim()
        .split(/\r?\n/)
        .filter(Boolean),
    ).toEqual(["storage/memories/memory-1/CONTENT.md"]);
    const connection = initializeDatabase(config);
    try {
      expect(await connection.repositories.backupEnvironment.getBackupFailsafeAlert())
        .toBeUndefined();
    } finally {
      connection.close();
    }
  });

  it("updates the backup stamp after the remote and branch identity are repaired", async () => {
    const root = await makeRoot();
    const missingRemotePath = join(root, "missing.git");
    const repairedRemotePath = join(root, "repaired.git");
    const configPath = await writeConfig(root, { push: true });
    const initialConfig = loadTraumaConfig({ configPath });
    const oldStore = join(root, "old-data/storage");
    await mkdir(join(oldStore, "memories", "memory-1"), { recursive: true });
    await writeFile(join(oldStore, "memories/memory-1/CONTENT.md"), "# Old\n", "utf8");
    await mkdir(initialConfig.projectPath, { recursive: true });
    git(initialConfig.projectPath, ["init", "--initial-branch=main"]);
    git(initialConfig.projectPath, ["remote", "add", "origin", missingRemotePath]);
    await seedPathDriftAlert(configPath, root);

    await expect(
      withGitIdentity(() =>
        runBackupFailsafeCli(["migrate", "--config", configPath, "--apply"]),
      ),
    ).rejects.toThrow(/git push failed/);

    git(root, ["init", "--bare", repairedRemotePath]);
    git(initialConfig.projectPath, ["remote", "set-url", "origin", repairedRemotePath]);
    git(initialConfig.projectPath, ["branch", "-m", "recovered"]);
    await rewriteConfiguredBackupBranch(configPath, "recovered");
    const repairedConfig = loadTraumaConfig({ configPath });
    let connection = initializeDatabase(repairedConfig);
    try {
      connection.sqlite.run(`
        CREATE TRIGGER reject_failsafe_alert_clear
        BEFORE DELETE ON backup_failsafe_alerts
        BEGIN
          SELECT RAISE(ABORT, 'forced stamp and alert atomicity failure');
        END;
      `);
    } finally {
      connection.close();
    }

    await expect(
      withGitIdentity(() =>
        runBackupFailsafeCli(["migrate", "--config", configPath, "--apply"]),
      ),
    ).rejects.toThrow(/forced stamp and alert atomicity failure/u);

    expect(hasRemoteBranch(repairedRemotePath, "recovered")).toBe(true);
    connection = initializeDatabase(repairedConfig);
    try {
      await expect(
        connection.repositories.backupEnvironment.getBackupEnvironmentStamp(),
      ).resolves.toMatchObject({
        gitBranch: "main",
        gitRemoteUrl: null,
        projectPath: join(root, "old-data"),
        storePath: join(root, "old-data/storage"),
      });
      await expect(
        connection.repositories.backupEnvironment.getBackupFailsafeAlert(),
      ).resolves.toMatchObject({ kind: "backup_push_failed" });
      connection.sqlite.run("DROP TRIGGER reject_failsafe_alert_clear;");
    } finally {
      connection.close();
    }

    const output = await withGitIdentity(() =>
      runBackupFailsafeCli(["migrate", "--config", configPath, "--apply"]),
    );

    expect(output).toContain("APPLY: Retry backup push");
    connection = initializeDatabase(repairedConfig);
    try {
      await expect(
        connection.repositories.backupEnvironment.getBackupEnvironmentStamp(),
      ).resolves.toMatchObject({
        gitBranch: "recovered",
        gitRemoteUrl: fingerprintGitRemote(repairedRemotePath),
      });
      await expect(
        ensureBackupEnvironment({ config: repairedConfig, db: connection.db }),
      ).resolves.toMatchObject({ ok: true, alert: undefined });
    } finally {
      connection.close();
    }
    expect(hasRemoteBranch(repairedRemotePath, "recovered")).toBe(true);
  });

  it("admits only one concurrent maintenance CLI for a failsafe alert", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    const config = loadTraumaConfig({ configPath });
    await seedPathDriftAlert(configPath, root);
    const releaseBarrier = await acquireBackupFailsafeActionLease(
      config.databasePath,
    );

    const first = runBackupFailsafeCli([
      "migrate",
      "--config",
      configPath,
      "--apply",
    ]);
    const second = runBackupFailsafeCli([
      "revert",
      "--config",
      configPath,
      "--apply",
    ]);
    const resultsPromise = Promise.allSettled([first, second]);
    await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
    releaseBarrier();

    const results = await resultsPromise;
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({
        message: expect.stringMatching(/already active|changed|stale|no active/u),
      }),
    });
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

  it("rejects unsupported source entries instead of silently omitting them", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    const oldStore = join(root, "old-data/storage");
    await mkdir(join(oldStore, "memories/memory-1"), { recursive: true });
    await writeFile(join(root, "outside.md"), "# Outside\n", "utf8");
    await symlink(
      join(root, "outside.md"),
      join(oldStore, "memories/memory-1/CONTENT.md"),
    );
    await seedPathDriftAlert(configPath, root);

    await expect(
      runBackupFailsafeCli(["migrate", "--config", configPath]),
    ).rejects.toThrow(/unsupported backup migration source entry/);
  });

  it("accepts current backup paths by committing existing store content when data has no previous stamp", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    const config = loadTraumaConfig({ configPath });
    await mkdir(join(config.storePath, "memories", "memory-1"), {
      recursive: true,
    });
    await writeFile(join(config.storePath, "memories/memory-1/CONTENT.md"), "# Current\n", "utf8");
    await mkdir(config.projectPath, { recursive: true });
    git(config.projectPath, ["init", "--initial-branch=main"]);
    const recoveryCredential = "recovery-secret";
    git(config.projectPath, [
      "remote",
      "add",
      "origin",
      `https://user:${recoveryCredential}@example.com/archive.git`,
    ]);
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
      const stamp =
        await connection.repositories.backupEnvironment.getBackupEnvironmentStamp();
      expect(stamp).toMatchObject({
          projectPath: config.projectPath,
          storePath: config.storePath,
        });
      expect(stamp?.gitRemoteUrl).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(JSON.stringify(stamp)).not.toContain(recoveryCredential);
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

  it("requires explicit recovery before replacing a legacy unknown remote identity", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    const config = loadTraumaConfig({ configPath });
    const remoteUrl = join(root, "current.git");
    await mkdir(join(config.storePath, "memories/memory-1"), { recursive: true });
    await writeFile(
      join(config.storePath, "memories/memory-1/CONTENT.md"),
      "# Current\n",
      "utf8",
    );
    await mkdir(config.projectPath, { recursive: true });
    git(config.projectPath, ["init", "--initial-branch=main"]);
    git(config.projectPath, ["remote", "add", "origin", remoteUrl]);
    const connection = initializeDatabase(config);
    try {
      await connection.repositories.memories.create({
        id: "memory-1",
        url: "https://example.com",
        title: "Legacy remote",
        description: null,
        faviconUrl: null,
        contentPath: "memories/memory-1/CONTENT.md",
        extractionStatus: "success",
        extractionError: null,
        backupStatus: "pending",
        lastBackupAt: null,
        lastBackupError: null,
        createdAt: now,
        updatedAt: now,
      });
      await connection.repositories.backupEnvironment.upsertBackupEnvironmentStamp({
        id: "default",
        projectPath: config.projectPath,
        storePath: config.storePath,
        gitRemote: "origin",
        gitRemoteUrl: "redacted:migration-0016",
        gitBranch: "main",
        createdAt: now,
        updatedAt: now,
      });
      await expect(ensureBackupEnvironment({ config, db: connection.db }))
        .resolves.toMatchObject({ ok: false });
      await expect(
        connection.repositories.backupEnvironment.getBackupEnvironmentStamp(),
      ).resolves.toMatchObject({ gitRemoteUrl: "redacted:migration-0016" });
    } finally {
      connection.close();
    }

    const output = await withGitIdentity(() =>
      runBackupFailsafeCli(["migrate", "--config", configPath, "--apply"]),
    );

    expect(output).toContain("APPLY: Accept current backup location");
    const check = initializeDatabase(config);
    try {
      await expect(check.repositories.backupEnvironment.getBackupFailsafeAlert())
        .resolves.toBeUndefined();
      await expect(check.repositories.backupEnvironment.getBackupEnvironmentStamp())
        .resolves.toMatchObject({
          gitRemoteUrl: fingerprintGitRemote(remoteUrl),
        });
    } finally {
      check.close();
    }
  });

  it("does not accept current paths for repository alerts", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    await seedRepositoryMissingAlert(configPath);

    await expect(
      runBackupFailsafeCli(["migrate", "--config", configPath, "--apply"]),
    ).rejects.toThrow(/cannot accept current backup paths/);

    const config = loadTraumaConfig({ configPath });
    const connection = initializeDatabase(config);
    try {
      expect(await connection.repositories.backupEnvironment.getBackupFailsafeAlert())
        .toMatchObject({ kind: "backup_repository_missing" });
    } finally {
      connection.close();
    }
  });

  it("does not accept current paths for content integrity alerts", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    await seedContentInconsistentAlert(configPath);

    await expect(
      runBackupFailsafeCli(["migrate", "--config", configPath, "--apply"]),
    ).rejects.toThrow(/cannot accept current backup paths/);

    const config = loadTraumaConfig({ configPath });
    const connection = initializeDatabase(config);
    try {
      expect(await connection.repositories.backupEnvironment.getBackupFailsafeAlert())
        .toMatchObject({ kind: "backup_content_inconsistent" });
    } finally {
      connection.close();
    }
  });

  it("deletes a missing successful memory record from a content integrity alert", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    const config = loadTraumaConfig({ configPath });
    await seedMissingContentRecord(configPath);

    const dryRunOutput = await runBackupFailsafeCli([
      "delete-missing-record",
      "--config",
      configPath,
    ]);

    expect(dryRunOutput).toContain("DRY RUN: Delete missing memory record");
    let connection = initializeDatabase(config);
    try {
      expect(await connection.repositories.memories.findById("memory-missing"))
        .toMatchObject({ id: "memory-missing" });
    } finally {
      connection.close();
    }

    const output = await runBackupFailsafeCli([
      "delete-missing-record",
      "--config",
      configPath,
      "--apply",
    ]);

    expect(output).toContain("APPLY: Delete missing memory record");
    expect(output).toContain("Alert cleared.");
    connection = initializeDatabase(config);
    try {
      expect(await connection.repositories.memories.findById("memory-missing"))
        .toBeUndefined();
      expect(await connection.repositories.backupEnvironment.getBackupFailsafeAlert())
        .toBeUndefined();
    } finally {
      connection.close();
    }
  });

  it("does not delete content integrity records when the content file still exists", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    const config = loadTraumaConfig({ configPath });
    await mkdir(join(config.storePath, "memories", "memory-untracked"), {
      recursive: true,
    });
    await writeFile(
      join(config.storePath, "memories/memory-untracked/CONTENT.md"),
      "# Exists\n",
      "utf8",
    );
    await seedMissingContentRecord(configPath, {
      id: "memory-untracked",
      contentPath: "memories/memory-untracked/CONTENT.md",
    });

    await expect(
      runBackupFailsafeCli([
        "delete-missing-record",
        "--config",
        configPath,
        "--apply",
      ]),
    ).rejects.toThrow(/only missing content records can be deleted/);

    const connection = initializeDatabase(config);
    try {
      expect(await connection.repositories.memories.findById("memory-untracked"))
        .toMatchObject({ id: "memory-untracked" });
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

async function runBackupFailsafeCli(args: readonly string[]) {
  if (!args.includes("--apply") || args.includes("--generation")) {
    return runRawBackupFailsafeCli(args);
  }
  const configIndex = args.indexOf("--config");
  const configPath = args[configIndex + 1];
  if (configPath === undefined) {
    return runRawBackupFailsafeCli(args);
  }
  const status = JSON.parse(await runRawBackupFailsafeCli([
    "status",
    "--config",
    configPath,
  ])) as { generation: string };
  return runRawBackupFailsafeCli([
    ...args,
    "--generation",
    status.generation,
  ]);
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

async function rewriteConfiguredBackupBranch(
  configPath: string,
  branch: string,
) {
  const parsed = JSON.parse(await readFile(configPath, "utf8")) as {
    backup: { git: { branch: string } };
  };
  parsed.backup.git.branch = branch;
  await writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

async function seedPathDriftAlert(
  configPath: string,
  root: string,
  paths: {
    previousProjectPath?: string;
    previousStorePath?: string;
  } = {},
) {
  const config = loadTraumaConfig({ configPath });
  const connection = initializeDatabase(config);
  try {
    await connection.repositories.backupEnvironment.upsertBackupEnvironmentStamp({
      id: "default",
      projectPath: paths.previousProjectPath ?? join(root, "old-data"),
      storePath: paths.previousStorePath ?? join(root, "old-data/storage"),
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
      previousProjectPath: paths.previousProjectPath ?? join(root, "old-data"),
      previousStorePath: paths.previousStorePath ?? join(root, "old-data/storage"),
      currentProjectPath: config.projectPath,
      currentStorePath: config.storePath,
      gitRemote: "origin",
      gitRemoteUrl: readTestRemoteFingerprint(config),
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
      gitRemoteUrl: readTestRemoteFingerprint(config),
      gitBranch: "main",
      error: null,
      createdAt: now,
      updatedAt: now,
    });
  } finally {
    connection.close();
  }
}

function readTestRemoteFingerprint(config: ReturnType<typeof loadTraumaConfig>) {
  try {
    const url = git(config.projectPath, [
      "remote",
      "get-url",
      config.backup.git.remote,
    ]).trim();
    return url === "" ? null : fingerprintGitRemote(url);
  } catch {
    return null;
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

async function seedRepositoryMissingAlert(configPath: string) {
  const config = loadTraumaConfig({ configPath });
  const connection = initializeDatabase(config);
  try {
    await connection.repositories.backupEnvironment.upsertBackupFailsafeAlert({
      id: "active",
      kind: "backup_repository_missing",
      severity: "critical",
      message: "Backup repository is not initialized",
      previousProjectPath: null,
      previousStorePath: null,
      currentProjectPath: config.projectPath,
      currentStorePath: config.storePath,
      gitRemote: "origin",
      gitRemoteUrl: null,
      gitBranch: "main",
      error: "projectPath is not a git repository",
      createdAt: now,
      updatedAt: now,
    });
  } finally {
    connection.close();
  }
}

async function seedContentInconsistentAlert(configPath: string) {
  const config = loadTraumaConfig({ configPath });
  const connection = initializeDatabase(config);
  try {
    await connection.repositories.backupEnvironment.upsertBackupFailsafeAlert({
      id: "active",
      kind: "backup_content_inconsistent",
      severity: "critical",
      message: "Backup content is inconsistent",
      previousProjectPath: null,
      previousStorePath: null,
      currentProjectPath: config.projectPath,
      currentStorePath: config.storePath,
      gitRemote: "origin",
      gitRemoteUrl: null,
      gitBranch: "main",
      error: "successful backup content is missing or untracked: memory-1",
      createdAt: now,
      updatedAt: now,
    });
  } finally {
    connection.close();
  }
}

async function seedMissingContentRecord(
  configPath: string,
  input: { id?: string; contentPath?: string } = {},
) {
  const config = loadTraumaConfig({ configPath });
  const memoryId = input.id ?? "memory-missing";
  const contentPath =
    input.contentPath ?? `memories/${memoryId}/CONTENT.md`;
  const connection = initializeDatabase(config);
  try {
    await connection.repositories.memories.create({
      id: memoryId,
      url: "https://example.com/missing",
      title: "Missing content",
      description: null,
      faviconUrl: null,
      contentPath,
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "success",
      lastBackupAt: now,
      lastBackupError: null,
      createdAt: now,
      updatedAt: now,
    });
    await connection.repositories.backupEnvironment.upsertBackupEnvironmentStamp({
      id: "default",
      projectPath: config.projectPath,
      storePath: config.storePath,
      gitRemote: "origin",
      gitRemoteUrl: null,
      gitBranch: "main",
      createdAt: now,
      updatedAt: now,
    });
    await connection.repositories.backupEnvironment.upsertBackupFailsafeAlert({
      id: "active",
      kind: "backup_content_inconsistent",
      severity: "critical",
      message: "Backup content is inconsistent",
      previousProjectPath: null,
      previousStorePath: null,
      currentProjectPath: config.projectPath,
      currentStorePath: config.storePath,
      gitRemote: "origin",
      gitRemoteUrl: null,
      gitBranch: "main",
      error: `successful backup content is missing or untracked: memoryId=${memoryId}, contentPath=${contentPath}, reason=missing_file`,
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

function hasRemoteBranch(remotePath: string, branch: string) {
  try {
    git(remotePath, ["rev-parse", "--verify", `refs/heads/${branch}`]);
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

async function installExecutableGitHooks(input: {
  hooks: readonly string[];
  hooksPath: string;
  markerPath: string;
}): Promise<void> {
  await mkdir(input.hooksPath, { recursive: true });
  await Promise.all(input.hooks.map(async (hook) => {
    const hookPath = join(input.hooksPath, hook);
    await writeFile(
      hookPath,
      `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(hook)} >> ${JSON.stringify(input.markerPath)}\n`,
      "utf8",
    );
    await chmod(hookPath, 0o755);
  }));
}

async function withGlobalGitConfig<T>(
  configPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = configPath;
  try {
    return await operation();
  } finally {
    if (previous === undefined) {
      delete process.env.GIT_CONFIG_GLOBAL;
    } else {
      process.env.GIT_CONFIG_GLOBAL = previous;
    }
  }
}

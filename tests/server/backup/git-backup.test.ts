import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  BACKUP_STATUSES,
  createGitMemoryBackupQueue,
  createSerializedGitBackupRunner,
  runGitBackupJob,
  type MemoryBackupJob,
} from "../../../src/server/backup";
import { initializeDatabase } from "../../../src/server/db";
import type { ResolvedTraumaConfig } from "../../../src/server/config";
import { PSYCHIATRIST_PROMPT_POLICY_VERSION } from "../../../src/server/psychiatrist/prompt";
import { loadPsychiatristStreamReplay } from "../../../src/server/psychiatrist/stream-store";
import {
  appendAssistantResponse,
  appendPendingPair,
  createPsychiatristThread,
  recordPsychiatristTurnStarted,
} from "../../../src/server/psychiatrist/thread-store";

const memoryId = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef801";
const capturedAt = "2026-05-09T08:00:00.000Z";
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("git backup runner", () => {
  it("uses the shared backup status source of truth", () => {
    expect([...BACKUP_STATUSES]).toEqual([
      "pending",
      "queued",
      "success",
      "failed",
      "disabled",
    ]);
  });

  it("serializes git backup jobs that target the same project path", async () => {
    const root = await makeRoot("trauma-git-backup-");
    const projectPath = join(root, "project");
    const storePath = join(projectPath, "store");
    const config = createConfig({ root, projectPath, storePath, push: false });
    const events: string[] = [];
    let firstStarted: () => void = () => {};
    let releaseFirst: () => void = () => {};
    const firstStartedPromise = new Promise<void>((resolveStarted) => {
      firstStarted = resolveStarted;
    });
    const releaseFirstPromise = new Promise<void>((resolveRelease) => {
      releaseFirst = resolveRelease;
    });
    const runner = createSerializedGitBackupRunner(async (input) => {
      events.push(`start:${input.job.memoryId}`);
      if (input.job.memoryId === "first-memory") {
        firstStarted();
        await releaseFirstPromise;
      }
      events.push(`end:${input.job.memoryId}`);
    });

    const first = runner({
      config,
      job: {
        memoryId: "first-memory",
        contentPaths: [`memories/first-memory/CONTENT.md`],
        reason: "memory_creation",
      },
    });
    await firstStartedPromise;

    const second = runner({
      config,
      job: {
        memoryId: "second-memory",
        contentPaths: [`memories/second-memory/CONTENT.md`],
        reason: "memory_creation",
      },
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 0));

    expect(events).toEqual(["start:first-memory"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual([
      "start:first-memory",
      "end:first-memory",
      "start:second-memory",
      "end:second-memory",
    ]);
  });

  it("stages only configured store content paths and creates a backup commit", async () => {
    const root = await makeRoot("trauma-git-backup-");
    const projectPath = join(root, "project");
    const storePath = join(projectPath, "store");
    const contentPath = `memories/${memoryId}/CONTENT.md`;
    await mkdir(join(storePath, "memories", memoryId), { recursive: true });
    await writeFile(
      join(storePath, contentPath),
      "# Backed Up\n\nMarkdown content.",
      "utf8",
    );
    await writeFile(join(projectPath, "outside.txt"), "leave me alone", "utf8");
    initializeGitRepository(projectPath);

    await runGitBackupJob({
      config: createConfig({ root, projectPath, storePath, push: false }),
      job: createJob({ contentPaths: [contentPath] }),
    });

    expect(git(projectPath, ["status", "--short"]).trim()).toBe("?? outside.txt");
    expect(git(projectPath, ["log", "-1", "--pretty=%s"]).trim()).toBe(
      `backup memory ${memoryId}`,
    );
    expect(
      git(projectPath, ["show", "--name-only", "--pretty=format:", "HEAD"])
        .trim()
        .split(/\r?\n/)
        .filter(Boolean),
    ).toEqual([`store/${contentPath}`]);
  });

  it("stages deleted store content paths and creates a deletion backup commit", async () => {
    const root = await makeRoot("trauma-git-backup-");
    const projectPath = join(root, "project");
    const storePath = join(projectPath, "store");
    const contentPath = `memories/${memoryId}/CONTENT.md`;
    const flashbackPath = `memories/${memoryId}/FLASHBACKS.json`;
    await mkdir(join(storePath, "memories", memoryId), { recursive: true });
    await writeFile(join(storePath, contentPath), "# Backed Up", "utf8");
    await writeFile(
      join(storePath, flashbackPath),
      `${JSON.stringify({ version: 1, memoryId, flashbacks: [] }, null, 2)}\n`,
      "utf8",
    );
    initializeGitRepository(projectPath);
    await runGitBackupJob({
      config: createConfig({ root, projectPath, storePath, push: false }),
      job: createJob({ contentPaths: [contentPath, flashbackPath] }),
    });
    await rm(join(storePath, "memories", memoryId), { recursive: true, force: true });

    await runGitBackupJob({
      config: createConfig({ root, projectPath, storePath, push: false }),
      job: createJob({
        contentPaths: [contentPath, flashbackPath],
        reason: "memory_deletion",
      }),
    });

    expect(git(projectPath, ["log", "-1", "--pretty=%s"]).trim()).toBe(
      `backup memory ${memoryId}`,
    );
    expect(
      git(projectPath, ["show", "--name-status", "--pretty=format:", "HEAD"])
        .trim()
        .split(/\r?\n/)
        .filter(Boolean),
    ).toEqual([
      `D\tstore/${contentPath}`,
      `D\tstore/${flashbackPath}`,
    ]);
  });

  it("skips missing untracked export paths while staging tracked memory deletions", async () => {
    const root = await makeRoot("trauma-git-backup-");
    const projectPath = join(root, "project");
    const storePath = join(projectPath, "store");
    const contentPath = `memories/${memoryId}/CONTENT.md`;
    const flashbackPath = `memories/${memoryId}/FLASHBACKS.json`;
    await mkdir(join(storePath, "memories", memoryId), { recursive: true });
    await writeFile(join(storePath, contentPath), "# Backed Up", "utf8");
    initializeGitRepository(projectPath);
    const config = createConfig({ root, projectPath, storePath, push: false });
    await runGitBackupJob({
      config,
      job: createJob({ contentPaths: [contentPath] }),
    });
    await writeFile(
      join(storePath, flashbackPath),
      `${JSON.stringify({ version: 1, memoryId, flashbacks: [] }, null, 2)}\n`,
      "utf8",
    );
    await rm(join(storePath, "memories", memoryId), { recursive: true, force: true });

    await runGitBackupJob({
      config,
      job: createJob({
        contentPaths: [contentPath, flashbackPath],
        reason: "memory_deletion",
      }),
    });

    expect(
      git(projectPath, ["show", "--name-status", "--pretty=format:", "HEAD"])
        .trim()
        .split(/\r?\n/)
        .filter(Boolean),
    ).toEqual([`D\tstore/${contentPath}`]);
  });

  it("expands human-readable backup actions in commit messages", async () => {
    const root = await makeRoot("trauma-git-backup-");
    const projectPath = join(root, "project");
    const storePath = join(projectPath, "store");
    const contentPath = `memories/${memoryId}/CONTENT.md`;
    const flashbackPath = `memories/${memoryId}/FLASHBACKS.json`;
    const translationPath = `memories/${memoryId}/ja-JP/CONTENT.md`;
    const psychiatristThreadPath = `memories/${memoryId}/threads/019e8a00-0000-7000-8000-000000000001/THREAD.md`;
    const psychiatristResponsePath = `memories/${memoryId}/threads/019e8a00-0000-7000-8000-000000000001/pairs/019e8a00-0000-7000-8000-000000000002/RESPONSE.md`;
    await mkdir(join(storePath, "memories", memoryId), { recursive: true });
    initializeGitRepository(projectPath);
    const config = createConfig({
      root,
      projectPath,
      storePath,
      push: false,
      commitMessageTemplate: "backup {action} {memory_id}",
    });

    await writeFile(join(storePath, contentPath), "# Created", "utf8");
    await runGitBackupJob({
      config,
      job: createJob({ contentPaths: [contentPath] }),
    });

    await writeFile(
      join(storePath, flashbackPath),
      `${JSON.stringify({ version: 1, memoryId, flashbacks: [] }, null, 2)}\n`,
      "utf8",
    );
    await runGitBackupJob({
      config,
      job: createJob({
        contentPaths: [flashbackPath],
        reason: "flashback_update",
      }),
    });

    await mkdir(join(storePath, "memories", memoryId, "ja-JP"), { recursive: true });
    await writeFile(join(storePath, translationPath), "# Translated", "utf8");
    await runGitBackupJob({
      config,
      job: createJob({
        contentPaths: [translationPath],
        reason: "translation_update",
      }),
    });

    await mkdir(join(storePath, "memories", memoryId, "threads", "019e8a00-0000-7000-8000-000000000001"), {
      recursive: true,
    });
    await writeFile(join(storePath, psychiatristThreadPath), "# Psychiatrist Thread", "utf8");
    await runGitBackupJob({
      config,
      job: createJob({
        contentPaths: [psychiatristThreadPath],
        reason: "psychiatrist_thread_update",
      }),
    });

    await mkdir(
      join(
        storePath,
        "memories",
        memoryId,
        "threads",
        "019e8a00-0000-7000-8000-000000000001",
        "pairs",
        "019e8a00-0000-7000-8000-000000000002",
      ),
      { recursive: true },
    );
    await writeFile(join(storePath, psychiatristResponsePath), "Regenerated", "utf8");
    await runGitBackupJob({
      config,
      job: createJob({
        contentPaths: [psychiatristResponsePath],
        reason: "psychiatrist_response_regenerate",
      }),
    });

    await rm(join(storePath, "memories", memoryId), { recursive: true, force: true });
    await runGitBackupJob({
      config,
      job: createJob({
        contentPaths: [contentPath, flashbackPath],
        reason: "memory_deletion",
      }),
    });

    expect(git(projectPath, ["log", "--pretty=%s"]).trim().split(/\r?\n/))
      .toEqual([
        `backup deleted memory ${memoryId}`,
        `backup regenerated psychiatrist response ${memoryId}`,
        `backup updated psychiatrist thread ${memoryId}`,
        `backup updated translation ${memoryId}`,
        `backup updated flashbacks ${memoryId}`,
        `backup created memory ${memoryId}`,
      ]);
  });

  it("does not push committed backup content when git push is disabled", async () => {
    const root = await makeRoot("trauma-git-backup-");
    const remotePath = join(root, "remote.git");
    const projectPath = join(root, "project");
    const storePath = join(projectPath, "store");
    const contentPath = `memories/${memoryId}/CONTENT.md`;
    await mkdir(join(storePath, "memories", memoryId), { recursive: true });
    await writeFile(join(storePath, contentPath), "# Local Only", "utf8");
    git(root, ["init", "--bare", remotePath]);
    initializeGitRepository(projectPath);
    git(projectPath, ["remote", "add", "origin", remotePath]);

    await runGitBackupJob({
      config: createConfig({ root, projectPath, storePath, push: false }),
      job: createJob({ contentPaths: [contentPath] }),
    });

    expect(hasRemoteMain(remotePath)).toBe(false);
  });

  it("skips push without warning when the configured remote name does not exist", async () => {
    const root = await makeRoot("trauma-git-backup-");
    const projectPath = join(root, "project");
    const storePath = join(projectPath, "store");
    const contentPath = `memories/${memoryId}/CONTENT.md`;
    await mkdir(join(storePath, "memories", memoryId), { recursive: true });
    await writeFile(join(storePath, contentPath), "# Local Missing Remote", "utf8");
    initializeGitRepository(projectPath);
    const config = createConfig({ root, projectPath, storePath, push: true });

    await runGitBackupJob({
      config,
      job: createJob({ contentPaths: [contentPath] }),
    });

    const connection = initializeDatabase(config);
    try {
      expect(await connection.repositories.backupEnvironment.getBackupFailsafeAlert())
        .toBeUndefined();
    } finally {
      connection.close();
    }
    expect(git(projectPath, ["log", "-1", "--pretty=%s"]).trim()).toBe(
      `backup memory ${memoryId}`,
    );
  });

  it("pushes an already committed backup when retrying after a failed push", async () => {
    const root = await makeRoot("trauma-git-backup-");
    const missingRemotePath = join(root, "missing.git");
    const remotePath = join(root, "remote.git");
    const projectPath = join(root, "project");
    const storePath = join(projectPath, "store");
    const contentPath = `memories/${memoryId}/CONTENT.md`;
    await mkdir(join(storePath, "memories", memoryId), { recursive: true });
    await writeFile(join(storePath, contentPath), "# Retry Push", "utf8");
    initializeGitRepository(projectPath);
    git(projectPath, ["remote", "add", "origin", missingRemotePath]);

    await expect(
      runGitBackupJob({
        config: createConfig({ root, projectPath, storePath, push: true }),
        job: createJob({ contentPaths: [contentPath] }),
      }),
    ).rejects.toThrow(/git push failed/);

    git(root, ["init", "--bare", remotePath]);
    git(projectPath, ["remote", "set-url", "origin", remotePath]);

    await runGitBackupJob({
      config: createConfig({ root, projectPath, storePath, push: true }),
      job: createJob({ contentPaths: [contentPath] }),
    });

    const connection = initializeDatabase(
      createConfig({ root, projectPath, storePath, push: true }),
    );
    try {
      expect(await connection.repositories.backupEnvironment.getBackupFailsafeAlert())
        .toBeUndefined();
    } finally {
      connection.close();
    }
    expect(hasRemoteMain(remotePath)).toBe(true);
    expect(
      git(remotePath, ["show", "--name-only", "--pretty=format:", "main"])
        .trim()
        .split(/\r?\n/)
        .filter(Boolean),
    ).toEqual([`store/${contentPath}`]);
  });

  it("records a failsafe alert when an existing remote push fails", async () => {
    const root = await makeRoot("trauma-git-backup-");
    const projectPath = join(root, "project");
    const storePath = join(projectPath, "store");
    const missingRemotePath = join(root, "missing.git");
    const contentPath = `memories/${memoryId}/CONTENT.md`;
    await mkdir(join(storePath, "memories", memoryId), { recursive: true });
    await writeFile(join(storePath, contentPath), "# Push Failure Alert", "utf8");
    initializeGitRepository(projectPath);
    git(projectPath, ["remote", "add", "origin", missingRemotePath]);
    const config = createConfig({ root, projectPath, storePath, push: true });

    await expect(
      runGitBackupJob({
        config,
        job: createJob({ contentPaths: [contentPath] }),
      }),
    ).rejects.toThrow(/git push failed/);

    const connection = initializeDatabase(config);
    try {
      expect(await connection.repositories.backupEnvironment.getBackupFailsafeAlert())
        .toMatchObject({
          kind: "backup_push_failed",
          severity: "critical",
          currentProjectPath: projectPath,
          currentStorePath: storePath,
          gitRemote: "origin",
          gitBranch: "main",
        });
    } finally {
      connection.close();
    }
    expect(git(projectPath, ["log", "-1", "--pretty=%s"]).trim()).toBe(
      `backup memory ${memoryId}`,
    );
  });

  it("fails before staging when projectPath is not its own git repository root", async () => {
    const root = await makeRoot("trauma-git-backup-");
    const appRepo = join(root, "app");
    const projectPath = join(appRepo, "data");
    const storePath = join(projectPath, "storage");
    const contentPath = `memories/${memoryId}/CONTENT.md`;
    await mkdir(join(storePath, "memories", memoryId), { recursive: true });
    await writeFile(join(storePath, contentPath), "# Nested Wrong Repo", "utf8");
    await mkdir(appRepo, { recursive: true });
    initializeGitRepository(appRepo);
    const config = createConfig({ root, projectPath, storePath, push: false });

    await expect(
      runGitBackupJob({
        config,
        job: createJob({ contentPaths: [contentPath] }),
      }),
    ).rejects.toThrow(/backup repository root/);

    expect(git(appRepo, ["diff", "--cached", "--name-only"]).trim()).toBe("");
    const connection = initializeDatabase(config);
    try {
      expect(await connection.repositories.backupEnvironment.getBackupFailsafeAlert())
        .toMatchObject({
          kind: "backup_repository_missing",
          severity: "critical",
          currentProjectPath: projectPath,
          currentStorePath: storePath,
        });
    } finally {
      connection.close();
    }
  });
});

describe("git memory backup queue", () => {
  it("recovers a durable intent after simulated process loss without running an incomplete job", async () => {
    const root = await makeRoot("trauma-git-backup-intent-");
    const projectPath = join(root, "project");
    const storePath = join(projectPath, "store");
    const config = createConfig({ root, projectPath, storePath, push: false });
    const contentPath = `memories/${memoryId}/CONTENT.md`;
    await mkdir(projectPath, { recursive: true });
    initializeGitRepository(projectPath);
    await mkdir(join(storePath, "memories", memoryId), { recursive: true });
    await writeFile(join(storePath, contentPath), "# Durable intent\n", "utf8");
    const connection = initializeDatabase(config);
    try {
      await connection.repositories.backupEnvironment.upsertBackupEnvironmentStamp({
        id: "default",
        projectPath: config.projectPath,
        storePath: config.storePath,
        gitRemote: config.backup.git.remote,
        gitRemoteUrl: null,
        gitBranch: config.backup.git.branch,
        createdAt: new Date(capturedAt),
        updatedAt: new Date(capturedAt),
      });
      await connection.repositories.memories.create({
        id: memoryId,
        url: "https://example.com/durable-intent",
        title: "Durable intent",
        description: null,
        faviconUrl: null,
        contentPath,
        extractionStatus: "success",
        extractionError: null,
        backupStatus: "success",
        lastBackupAt: new Date(capturedAt),
        lastBackupError: null,
        createdAt: new Date(capturedAt),
        updatedAt: new Date(capturedAt),
      });
    } finally {
      connection.close();
    }

    const processedBeforeRestart: MemoryBackupJob[] = [];
    const abandonedQueue = createGitMemoryBackupQueue({
      config,
      runJob: async ({ job }) => {
        processedBeforeRestart.push(job);
      },
    });
    await abandonedQueue.persistIntent({
      contentPaths: [contentPath],
      memoryId,
      reason: "psychiatrist_thread_update",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const threadId = "019e8a00-0000-7000-8000-000000000001";
    const pairId = "019e8a00-0000-7000-8000-000000000002";
    const turnId = "019e8a00-0000-7000-8000-000000000003";
    await createPsychiatristThread({
      config,
      manifest: {
        activeContentHash: "sha256:source",
        createdAt: capturedAt,
        memoryId,
        policyVersion: PSYCHIATRIST_PROMPT_POLICY_VERSION,
        sourceHash: "sha256:source",
        status: "ready",
        threadId,
        updatedAt: capturedAt,
        variantKind: "source",
      },
    });
    await appendPendingPair({
      config,
      contextSnapshot: {
        categories: [],
        contentHash: "sha256:source",
        contextSnapshotId: pairId,
        memoryId,
        policyVersion: PSYCHIATRIST_PROMPT_POLICY_VERSION,
        relativePath: contentPath,
        selectedSectionAnchors: [],
        selectedSectionHashes: [],
        sections: [],
        sourceUrl: "https://example.com/durable-intent",
        tags: [],
        title: "Durable intent",
        userPrompt: "What survives?",
        variantKind: "source",
      },
      pairId,
      prompt: "What survives?",
      threadId,
      turnId,
    });
    await recordPsychiatristTurnStarted({
      config,
      pairId,
      threadId,
      turnId,
    });
    await appendAssistantResponse({
      assistantResponse: "This completed answer survives process loss.",
      citations: [],
      config,
      pairId,
      threadId,
    });

    const pendingConnection = initializeDatabase(config);
    try {
      await expect(pendingConnection.repositories.memories.findById(memoryId))
        .resolves.toMatchObject({ backupStatus: "pending" });
    } finally {
      pendingConnection.close();
    }
    expect(processedBeforeRestart).toEqual([]);

    const processedAfterRestart: MemoryBackupJob[] = [];
    const restartedQueue = createGitMemoryBackupQueue({
      config,
      runJob: async ({ job }) => {
        processedAfterRestart.push(job);
      },
    });
    await expect(restartedQueue.retryEligibleBackups()).resolves.toBe(1);
    await restartedQueue.drain();

    expect(processedAfterRestart).toEqual([
      expect.objectContaining({
        contentPaths: expect.arrayContaining([
          contentPath,
          `memories/${memoryId}/threads/${threadId}/THREAD.json`,
          `memories/${memoryId}/threads/${threadId}/THREAD.md`,
          `memories/${memoryId}/threads/${threadId}/PAIRS.jsonl`,
          `memories/${memoryId}/threads/${threadId}/pairs/${pairId}/RESPONSE.md`,
          `memories/${memoryId}/threads/${threadId}/turns/${turnId}.json`,
          `memories/${memoryId}/threads/${threadId}/streams/${turnId}.jsonl`,
        ]),
        memoryId,
      }),
    ]);
    await expect(readFile(
      join(storePath, "memories", memoryId, "threads", threadId, "turns", `${turnId}.json`),
      "utf8",
    ).then((content) => JSON.parse(content))).resolves.toMatchObject({
      pair_id: pairId,
      status: "completed",
      turn_id: turnId,
    });
    await expect(loadPsychiatristStreamReplay({
      config,
      memoryId,
      threadId,
      turnId,
    })).resolves.toContainEqual(expect.objectContaining({
      data: expect.objectContaining({
        pair_id: pairId,
        text: "This completed answer survives process loss.",
      }),
      type: "psychiatrist.answer.completed",
    }));
    const completedConnection = initializeDatabase(config);
    try {
      await expect(completedConnection.repositories.memories.findById(memoryId))
        .resolves.toMatchObject({ backupStatus: "success" });
    } finally {
      completedConnection.close();
    }
  });

  it("rejects asynchronous memory deletion jobs", async () => {
    const root = await makeRoot("trauma-git-backup-");
    const projectPath = join(root, "project");
    const storePath = join(projectPath, "store");
    const queue = createGitMemoryBackupQueue({
      config: createConfig({ root, projectPath, storePath, push: false }),
    });

    await expect(
      queue.enqueue({
        memoryId,
        contentPaths: [`memories/${memoryId}/CONTENT.md`],
        reason: "memory_deletion",
      }),
    ).rejects.toThrow(
      "memory deletion backups must run synchronously before deleting the memory row",
    );
  });

  it("marks backup failure without removing the memory row or markdown content", async () => {
    const root = await makeRoot("trauma-git-backup-");
    const output = runBunScript(
      `
        import { existsSync } from "node:fs";
        import { join } from "node:path";
        import { createGitMemoryBackupQueue } from "./src/server/backup/index.ts";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { writeMemoryContent } from "./src/server/store/memory-content.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const memoryId = ${JSON.stringify(memoryId)};
        const capturedAt = new Date(${JSON.stringify(capturedAt)});
        const config = createConfig(root);
        const connection = initializeDatabase(config);
        try {
          await writeMemoryContent({
            config: { storePath: config.storePath },
            memoryId,
            frontmatter: {
              id: memoryId,
              url: "https://example.com/backup-failure",
              title: "Backup Failure",
              capturedAt: capturedAt.toISOString(),
              extractionStatus: "success",
            },
            markdown: "# Backup Failure\\n\\nThis content must survive.",
          });
          await connection.repositories.memories.create({
            id: memoryId,
            url: "https://example.com/backup-failure",
            title: "Backup Failure",
            description: null,
            faviconUrl: null,
            contentPath: \`memories/\${memoryId}/CONTENT.md\`,
            extractionStatus: "success",
            extractionError: null,
            backupStatus: "pending",
            lastBackupAt: null,
            lastBackupError: null,
            createdAt: capturedAt,
            updatedAt: capturedAt,
          });
        } finally {
          connection.close();
        }

        const queue = createGitMemoryBackupQueue({
          config,
          now: () => new Date(${JSON.stringify(capturedAt)}),
        });
        const enqueueResult = await queue.enqueue({
          memoryId,
          contentPaths: [\`memories/\${memoryId}/CONTENT.md\`],
          reason: "memory_creation",
        });
        await queue.drain();

        const check = initializeDatabase(config);
        try {
          const stored = await check.repositories.memories.findById(memoryId);
          const contentExists = existsSync(join(config.storePath, \`memories/\${memoryId}/CONTENT.md\`));
          process.stdout.write(JSON.stringify({ enqueueResult, stored, contentExists }));
        } finally {
          check.close();
        }

        function createConfig(root) {
          return {
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
        }
      `,
      root,
    );
    const { enqueueResult, stored, contentExists } = JSON.parse(output);

    expect(enqueueResult).toEqual({ backupStatus: "queued" });
    expect(contentExists).toBe(true);
    expect(stored).toMatchObject({
      id: memoryId,
      title: "Backup Failure",
      backupStatus: "failed",
    });
    expect(stored.lastBackupError).toContain("git");
  });

  it("retries pending, queued, and failed backups once without duplicating active work", async () => {
    const root = await makeRoot("trauma-git-backup-");
    const output = runBunScript(
      `
        import { execFileSync } from "node:child_process";
        import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
        import { join } from "node:path";
        import { createGitMemoryBackupQueue } from "./src/server/backup/index.ts";
        import { initializeDatabase } from "./src/server/db/index.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const now = new Date(${JSON.stringify(capturedAt)});
        const config = createConfig(root);
        const ids = {
          pending: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef811",
          failed: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef812",
          queued: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef813",
          success: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef814",
        };
        mkdirSync(config.projectPath, { recursive: true });
        execFileSync("git", ["init", "--initial-branch=main"], {
          cwd: config.projectPath,
          env: createGitEnv(),
          stdio: ["ignore", "pipe", "pipe"],
        });
        for (const id of Object.values(ids)) {
          mkdirSync(join(config.storePath, "memories", id), {
            recursive: true,
          });
          writeFileSync(
            join(config.storePath, "memories", id, "CONTENT.md"),
            "# Backup candidate\\n",
          );
          writeFileSync(
            join(config.storePath, "memories", id, "FLASHBACKS.json"),
            JSON.stringify({ version: 1, memoryId: id, flashbacks: [] }, null, 2) + "\\n",
          );
        }
        mkdirSync(join(config.storePath, "memories", ids.failed, "ja-JP"), {
          recursive: true,
        });
        writeFileSync(
          join(config.storePath, "memories", ids.failed, "ja-JP", "CONTENT.md"),
          "# 翻訳済みバックアップ候補\\n",
        );
        writeFileSync(
          join(config.storePath, "memories", ids.failed, "ja-JP", "TRANSLATION_MAP.json"),
          JSON.stringify({ version: 1, memoryId: ids.failed, spans: [] }, null, 2) + "\\n",
        );
        writeFileSync(
          join(config.storePath, "memories", ids.failed, "ja-JP", "FLASHBACKS.json"),
          JSON.stringify({ version: 2, memoryId: ids.failed, flashbacks: [] }, null, 2) + "\\n",
        );
        mkdirSync(
          join(
            config.storePath,
            "memories",
            ids.failed,
            "threads",
            "019e8a00-0000-7000-8000-000000000001",
            "pairs",
            "019e8a00-0000-7000-8000-000000000002",
          ),
          { recursive: true },
        );
        mkdirSync(
          join(
            config.storePath,
            "memories",
            ids.failed,
            "threads",
            "019e8a00-0000-7000-8000-000000000001",
            "turns",
          ),
          { recursive: true },
        );
        mkdirSync(
          join(
            config.storePath,
            "memories",
            ids.failed,
            "threads",
            "019e8a00-0000-7000-8000-000000000001",
            "streams",
          ),
          { recursive: true },
        );
        writeFileSync(
          join(
            config.storePath,
            "memories",
            ids.failed,
            "threads",
            "019e8a00-0000-7000-8000-000000000001",
            "THREAD.json",
          ),
          JSON.stringify({ thread_id: "019e8a00-0000-7000-8000-000000000001" }) + "\\n",
        );
        writeFileSync(
          join(
            config.storePath,
            "memories",
            ids.failed,
            "threads",
            "019e8a00-0000-7000-8000-000000000001",
            "THREAD.md",
          ),
          "# Psychiatrist Thread\\n",
        );
        writeFileSync(
          join(
            config.storePath,
            "memories",
            ids.failed,
            "threads",
            "019e8a00-0000-7000-8000-000000000001",
            "PAIRS.jsonl",
          ),
          "{}\\n",
        );
        writeFileSync(
          join(
            config.storePath,
            "memories",
            ids.failed,
            "threads",
            "019e8a00-0000-7000-8000-000000000001",
            "turns",
            "019e8a00-0000-7000-8000-000000000003.json",
          ),
          JSON.stringify({
            pair_id: "019e8a00-0000-7000-8000-000000000002",
            status: "completed",
            turn_id: "019e8a00-0000-7000-8000-000000000003",
          }) + "\\n",
        );
        writeFileSync(
          join(
            config.storePath,
            "memories",
            ids.failed,
            "threads",
            "019e8a00-0000-7000-8000-000000000001",
            "streams",
            "019e8a00-0000-7000-8000-000000000003.jsonl",
          ),
          "{}\\n",
        );
        writeFileSync(
          join(
            config.storePath,
            "memories",
            ids.failed,
            "threads",
            "019e8a00-0000-7000-8000-000000000001",
            "pairs",
            "019e8a00-0000-7000-8000-000000000002",
            "PROMPT.md",
          ),
          "What changed?\\n",
        );
        writeFileSync(
          join(
            config.storePath,
            "memories",
            ids.failed,
            "threads",
            "019e8a00-0000-7000-8000-000000000001",
            "pairs",
            "019e8a00-0000-7000-8000-000000000002",
            "CONTEXT.json",
          ),
          "{}\\n",
        );
        writeFileSync(
          join(
            config.storePath,
            "memories",
            ids.failed,
            "threads",
            "019e8a00-0000-7000-8000-000000000001",
            "pairs",
            "019e8a00-0000-7000-8000-000000000002",
            "RESPONSE.md",
          ),
          "Answer.\\n",
        );
        unlinkSync(join(config.storePath, "memories", ids.failed, "FLASHBACKS.json"));
        execFileSync(
          "git",
          [
            "add",
            "--",
            join("store", "memories", ids.success, "CONTENT.md"),
          ],
          {
            cwd: config.projectPath,
            env: createGitEnv(),
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        const connection = initializeDatabase(config);
        try {
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
          for (const [statusName, id] of Object.entries(ids)) {
            await connection.repositories.memories.create({
              id,
              url: \`https://example.com/\${statusName}\`,
              title: statusName,
              description: null,
              faviconUrl: null,
              contentPath: \`memories/\${id}/CONTENT.md\`,
              extractionStatus: "success",
              extractionError: null,
              backupStatus: statusName,
              lastBackupAt: statusName === "success" ? now : null,
              lastBackupError: statusName === "failed" ? "previous failure" : null,
              createdAt: now,
              updatedAt: now,
            });
          }
          await connection.repositories.translations.createTranslationJob({
            jobId: "retry-translation-ja",
            memoryId: ids.failed,
            langCode: "ja-JP",
            sourceHash: "sha256:retry-source",
            model: "codex-test",
            reasoningEffort: null,
            promptPolicyVersion: "brilliant-v1",
            chunkerVersion: "chunker-v1",
            chunkCount: 1,
            now,
          });
          await connection.repositories.translations.updateTranslationJobStatus(
            "retry-translation-ja",
            "complete",
            {
              completedAt: now,
              outputHash: "sha256:retry-output",
              outputPath: \`memories/\${ids.failed}/ja-JP/CONTENT.md\`,
              updatedAt: now,
            },
          );
        } finally {
          connection.close();
        }

        const processed = [];
        const queue = createGitMemoryBackupQueue({
          config,
          now: () => now,
          runJob: async ({ job }) => {
            processed.push({
              memoryId: job.memoryId,
              contentPaths: job.contentPaths,
            });
          },
        });
        const retryCount = await queue.retryEligibleBackups();
        await queue.enqueue({
          memoryId: ids.pending,
          contentPaths: [\`memories/\${ids.pending}/CONTENT.md\`],
          reason: "memory_creation",
        });
        await queue.drain();

        const check = initializeDatabase(config);
        try {
          const rows = check.sqlite
            .prepare("select id, backup_status as backupStatus, last_backup_error as lastBackupError from memories order by id")
            .all();
          process.stdout.write(JSON.stringify({ retryCount, processed, rows }));
        } finally {
          check.close();
        }

        function createConfig(root) {
          return {
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
        }

        function createGitEnv() {
          const env = { ...process.env };
          delete env.GIT_DIR;
          delete env.GIT_WORK_TREE;
          delete env.GIT_INDEX_FILE;
          return env;
        }
      `,
      root,
    );
    const { retryCount, processed, rows } = JSON.parse(output);

    expect(retryCount).toBe(3);
    expect(processed).toEqual([
      {
        memoryId: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef811",
        contentPaths: [
          "memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef811/CONTENT.md",
          "memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef811/FLASHBACKS.json",
        ],
      },
      {
        memoryId: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef812",
        contentPaths: [
          "memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef812/CONTENT.md",
          "memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef812/FLASHBACKS.json",
          "memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef812/ja-JP/CONTENT.md",
          "memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef812/ja-JP/TRANSLATION_MAP.json",
          "memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef812/ja-JP/FLASHBACKS.json",
          "memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef812/threads/019e8a00-0000-7000-8000-000000000001/THREAD.json",
          "memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef812/threads/019e8a00-0000-7000-8000-000000000001/THREAD.md",
          "memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef812/threads/019e8a00-0000-7000-8000-000000000001/PAIRS.jsonl",
          "memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef812/threads/019e8a00-0000-7000-8000-000000000001/turns/019e8a00-0000-7000-8000-000000000003.json",
          "memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef812/threads/019e8a00-0000-7000-8000-000000000001/streams/019e8a00-0000-7000-8000-000000000003.jsonl",
          "memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef812/threads/019e8a00-0000-7000-8000-000000000001/pairs/019e8a00-0000-7000-8000-000000000002/PROMPT.md",
          "memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef812/threads/019e8a00-0000-7000-8000-000000000001/pairs/019e8a00-0000-7000-8000-000000000002/CONTEXT.json",
          "memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef812/threads/019e8a00-0000-7000-8000-000000000001/pairs/019e8a00-0000-7000-8000-000000000002/RESPONSE.md",
        ],
      },
      {
        memoryId: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef813",
        contentPaths: [
          "memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef813/CONTENT.md",
          "memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef813/FLASHBACKS.json",
        ],
      },
    ]);
    expect(rows).toEqual([
      {
        id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef811",
        backupStatus: "success",
        lastBackupError: null,
      },
      {
        id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef812",
        backupStatus: "success",
        lastBackupError: null,
      },
      {
        id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef813",
        backupStatus: "success",
        lastBackupError: null,
      },
      {
        id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef814",
        backupStatus: "success",
        lastBackupError: null,
      },
    ]);
  });

  it("does not retry eligible backups while backup environment failsafe is active", async () => {
    const root = await makeRoot("trauma-git-backup-");
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { createGitMemoryBackupQueue } from "./src/server/backup/index.ts";
        import { initializeDatabase } from "./src/server/db/index.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const now = new Date(${JSON.stringify(capturedAt)});
        const config = createConfig(root);
        const connection = initializeDatabase(config);
        try {
          await connection.repositories.backupEnvironment.upsertBackupEnvironmentStamp({
            id: "default",
            projectPath: join(root, "old-data"),
            storePath: join(root, "old-data/store"),
            gitRemote: "origin",
            gitRemoteUrl: null,
            gitBranch: "main",
            createdAt: now,
            updatedAt: now,
          });
          await connection.repositories.memories.create({
            id: ${JSON.stringify(memoryId)},
            url: "https://example.com/drift-retry",
            title: "Drift Retry",
            description: null,
            faviconUrl: null,
            contentPath: \`memories/${memoryId}/CONTENT.md\`,
            extractionStatus: "success",
            extractionError: null,
            backupStatus: "failed",
            lastBackupAt: null,
            lastBackupError: "previous failure",
            createdAt: now,
            updatedAt: now,
          });
        } finally {
          connection.close();
        }

        const processed = [];
        const queue = createGitMemoryBackupQueue({
          config,
          now: () => now,
          runJob: async ({ job }) => {
            processed.push(job.memoryId);
          },
        });
        let errorName = null;
        let errorMessage = null;
        try {
          await queue.retryEligibleBackups();
        } catch (error) {
          errorName = error?.name ?? null;
          errorMessage = error?.message ?? null;
        }

        const check = initializeDatabase(config);
        try {
          const alert = await check.repositories.backupEnvironment.getBackupFailsafeAlert();
          process.stdout.write(JSON.stringify({ processed, errorName, errorMessage, alert }));
        } finally {
          check.close();
        }

        function createConfig(root) {
          return {
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
        }
      `,
      root,
    );
    const { processed, errorName, errorMessage, alert } = JSON.parse(output);

    expect(processed).toEqual([]);
    expect(errorName).toBe("BackupEnvironmentFailsafeError");
    expect(errorMessage).toBe("Backup location changed");
    expect(alert).toMatchObject({
      kind: "backup_path_drift",
      currentProjectPath: join(root, "data"),
      currentStorePath: join(root, "data/store"),
    });
  });

  it("preserves follow-up backup work enqueued while the same memory is active", async () => {
    const root = await makeRoot("trauma-git-backup-");
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { createGitMemoryBackupQueue } from "./src/server/backup/index.ts";
        import { initializeDatabase } from "./src/server/db/index.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const now = new Date(${JSON.stringify(capturedAt)});
        const config = createConfig(root);
        const connection = initializeDatabase(config);
        try {
          await connection.repositories.memories.create({
            id: ${JSON.stringify(memoryId)},
            url: "https://example.com/follow-up",
            title: "Follow Up",
            description: null,
            faviconUrl: null,
            contentPath: \`memories/${memoryId}/CONTENT.md\`,
            extractionStatus: "success",
            extractionError: null,
            backupStatus: "pending",
            lastBackupAt: null,
            lastBackupError: null,
            createdAt: now,
            updatedAt: now,
          });
        } finally {
          connection.close();
        }

        const processed = [];
        let queue;
        queue = createGitMemoryBackupQueue({
          config,
          now: () => now,
          runJob: async ({ job }) => {
            processed.push({
              memoryId: job.memoryId,
              contentPaths: [...job.contentPaths],
              reason: job.reason,
            });
            if (processed.length === 1) {
              await queue.enqueue({
                memoryId: job.memoryId,
                contentPaths: [\`memories/${memoryId}/FLASHBACKS.json\`],
                reason: "flashback_update",
              });
            }
          },
        });

        await queue.enqueue({
          memoryId: ${JSON.stringify(memoryId)},
          contentPaths: [\`memories/${memoryId}/CONTENT.md\`],
          reason: "memory_creation",
        });
        await queue.drain();
        process.stdout.write(JSON.stringify({ processed }));

        function createConfig(root) {
          return {
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
        }
      `,
      root,
    );
    const { processed } = JSON.parse(output);

    expect(processed).toEqual([
      {
        memoryId,
        contentPaths: [`memories/${memoryId}/CONTENT.md`],
        reason: "memory_creation",
      },
      {
        memoryId,
        contentPaths: [`memories/${memoryId}/FLASHBACKS.json`],
        reason: "flashback_update",
      },
    ]);
  });

  it.each(["identical", "subset"] as const)(
    "runs a follow-up backup when a %s-path request arrives during an active backup",
    async (requestShape) => {
      const root = await makeRoot("trauma-git-backup-same-path-follow-up-");
      const projectPath = join(root, "project");
      const storePath = join(projectPath, "store");
      const config = createConfig({ root, projectPath, storePath, push: false });
      const contentPath = `memories/${memoryId}/CONTENT.md`;
      const additionalPath = `memories/${memoryId}/THREAD.md`;
      await seedBackupQueueMemory({ config, contentPath });
      await writeFile(join(storePath, contentPath), "first snapshot\n", "utf8");

      let releaseFirstRun: () => void = () => {};
      const firstRunGate = new Promise<void>((resolve) => {
        releaseFirstRun = resolve;
      });
      let markFirstSnapshot: () => void = () => {};
      const firstSnapshotTaken = new Promise<void>((resolve) => {
        markFirstSnapshot = resolve;
      });
      const snapshots: string[] = [];
      const queue = createGitMemoryBackupQueue({
        config,
        runJob: async ({ job }) => {
          const snapshotPath = job.contentPaths[0];
          if (snapshotPath === undefined) {
            throw new Error("backup job did not include a content path");
          }
          snapshots.push(await readFile(join(storePath, snapshotPath), "utf8"));
          if (snapshots.length === 1) {
            markFirstSnapshot();
            await firstRunGate;
          }
        },
      });

      await queue.enqueue({
        contentPaths: requestShape === "subset"
          ? [contentPath, additionalPath]
          : [contentPath],
        memoryId,
        reason: "memory_creation",
      });
      await firstSnapshotTaken;
      await writeFile(join(storePath, contentPath), "second snapshot\n", "utf8");
      await queue.enqueue({
        contentPaths: [contentPath],
        memoryId,
        reason: "psychiatrist_thread_update",
      });
      releaseFirstRun();
      await queue.drain();

      expect(snapshots).toEqual(["first snapshot\n", "second snapshot\n"]);
    },
  );

  it("persists queued state and completes a caller finalizer before starting the worker", async () => {
    const root = await makeRoot("trauma-git-backup-finalizer-order-");
    const projectPath = join(root, "project");
    const storePath = join(projectPath, "store");
    const config = createConfig({ root, projectPath, storePath, push: false });
    const contentPath = `memories/${memoryId}/CONTENT.md`;
    await seedBackupQueueMemory({ config, contentPath });

    let releaseFinalizer: () => void = () => {};
    const finalizerGate = new Promise<void>((resolve) => {
      releaseFinalizer = resolve;
    });
    let markFinalizerStarted: () => void = () => {};
    const finalizerStarted = new Promise<void>((resolve) => {
      markFinalizerStarted = resolve;
    });
    let markWorkerStarted: () => void = () => {};
    const workerStarted = new Promise<void>((resolve) => {
      markWorkerStarted = resolve;
    });
    const order: string[] = [];
    const queue = createGitMemoryBackupQueue({
      config,
      runJob: async () => {
        order.push("worker");
        markWorkerStarted();
      },
    });

    const enqueuePromise = queue.enqueue({
      contentPaths: [contentPath],
      memoryId,
      reason: "psychiatrist_thread_update",
    }, async (result) => {
      const connection = initializeDatabase(config);
      try {
        const memory = await connection.repositories.memories.findById(memoryId);
        order.push(`finalizer:${result.backupStatus}:${memory?.backupStatus}`);
      } finally {
        connection.close();
      }
      markFinalizerStarted();
      await finalizerGate;
      order.push("finalizer:complete");
    });

    await expect(Promise.race([
      finalizerStarted.then(() => "finalizer"),
      workerStarted.then(() => "worker"),
    ])).resolves.toBe("finalizer");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["finalizer:queued:queued"]);
    releaseFinalizer();
    await enqueuePromise;
    await queue.drain();

    expect(order).toEqual([
      "finalizer:queued:queued",
      "finalizer:complete",
      "worker",
    ]);
  });

  it("keeps durable queued intent when the caller finalizer fails", async () => {
    const root = await makeRoot("trauma-git-backup-finalizer-failure-");
    const projectPath = join(root, "project");
    const storePath = join(projectPath, "store");
    const config = createConfig({ root, projectPath, storePath, push: false });
    const contentPath = `memories/${memoryId}/CONTENT.md`;
    await seedBackupQueueMemory({ config, contentPath });
    let releaseActiveRun: () => void = () => {};
    const activeRunGate = new Promise<void>((resolve) => {
      releaseActiveRun = resolve;
    });
    let markActiveRunStarted: () => void = () => {};
    const activeRunStarted = new Promise<void>((resolve) => {
      markActiveRunStarted = resolve;
    });
    const processed: MemoryBackupJob[] = [];
    const queue = createGitMemoryBackupQueue({
      config,
      runJob: async ({ job }) => {
        processed.push(job);
        if (processed.length === 1) {
          markActiveRunStarted();
          await activeRunGate;
        }
      },
    });

    await queue.enqueue({
      contentPaths: [contentPath],
      memoryId,
      reason: "memory_creation",
    });
    await activeRunStarted;
    let finalizerError: unknown;
    try {
      await queue.enqueue({
        contentPaths: [contentPath],
        memoryId,
        reason: "psychiatrist_thread_update",
      }, async () => {
        throw new Error("terminal stream finalization failed");
      });
    } catch (error) {
      finalizerError = error;
    }
    releaseActiveRun();
    await queue.drain();

    expect(finalizerError).toEqual(expect.objectContaining({
      message: "terminal stream finalization failed",
    }));
    expect(processed).toHaveLength(1);
    const connection = initializeDatabase(config);
    try {
      await expect(connection.repositories.memories.findById(memoryId))
        .resolves.toMatchObject({
          backupStatus: "pending",
          lastBackupError: null,
        });
    } finally {
      connection.close();
    }
  });

  it("keeps the last successful backup timestamp when a later backup fails", async () => {
    const root = await makeRoot("trauma-git-backup-");
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { createGitMemoryBackupQueue } from "./src/server/backup/index.ts";
        import { initializeDatabase } from "./src/server/db/index.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const successAt = new Date(${JSON.stringify(capturedAt)});
        const failureAt = new Date("2026-05-09T09:00:00.000Z");
        let currentTime = successAt;
        let shouldFail = false;
        const config = createConfig(root);
        const connection = initializeDatabase(config);
        try {
          await connection.repositories.memories.create({
            id: ${JSON.stringify(memoryId)},
            url: "https://example.com/failure-after-success",
            title: "Failure After Success",
            description: null,
            faviconUrl: null,
            contentPath: \`memories/${memoryId}/CONTENT.md\`,
            extractionStatus: "success",
            extractionError: null,
            backupStatus: "pending",
            lastBackupAt: null,
            lastBackupError: null,
            createdAt: successAt,
            updatedAt: successAt,
          });
        } finally {
          connection.close();
        }

        const queue = createGitMemoryBackupQueue({
          config,
          now: () => currentTime,
          runJob: async () => {
            if (shouldFail) {
              throw new Error("follow-up backup failed");
            }
          },
        });

        await queue.enqueue({
          memoryId: ${JSON.stringify(memoryId)},
          contentPaths: [\`memories/${memoryId}/CONTENT.md\`],
          reason: "memory_creation",
        });
        await queue.drain();

        shouldFail = true;
        currentTime = failureAt;
        await queue.enqueue({
          memoryId: ${JSON.stringify(memoryId)},
          contentPaths: [\`memories/${memoryId}/CONTENT.md\`],
          reason: "flashback_update",
        });
        await queue.drain();

        const check = initializeDatabase(config);
        try {
          const row = check.sqlite
            .prepare("select backup_status as backupStatus, last_backup_at as lastBackupAt, last_backup_error as lastBackupError from memories where id = ?")
            .get(${JSON.stringify(memoryId)});
          process.stdout.write(JSON.stringify({ row, successAt: successAt.getTime() }));
        } finally {
          check.close();
        }

        function createConfig(root) {
          return {
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
        }
      `,
      root,
    );
    const { row, successAt } = JSON.parse(output);

    expect(row).toEqual({
      backupStatus: "failed",
      lastBackupAt: successAt,
      lastBackupError: "follow-up backup failed",
    });
  });
});

async function makeRoot(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}

async function seedBackupQueueMemory(input: {
  config: ResolvedTraumaConfig;
  contentPath: string;
}) {
  await mkdir(join(input.config.storePath, "memories", memoryId), { recursive: true });
  const connection = initializeDatabase(input.config);
  try {
    await connection.repositories.memories.create({
      id: memoryId,
      url: "https://example.com/backup-queue",
      title: "Backup queue",
      description: null,
      faviconUrl: null,
      contentPath: input.contentPath,
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "pending",
      lastBackupAt: null,
      lastBackupError: null,
      createdAt: new Date(capturedAt),
      updatedAt: new Date(capturedAt),
    });
  } finally {
    connection.close();
  }
}

function createConfig(input: {
  commitMessageTemplate?: string;
  root: string;
  projectPath: string;
  storePath: string;
  push: boolean;
}): ResolvedTraumaConfig {
  return {
    configFilePath: join(input.root, "trauma.config.json"),
    projectPath: input.projectPath,
    storePath: input.storePath,
    databasePath: join(input.root, ".trauma/trauma.sqlite"),
    backup: {
      git: {
        enabled: true,
        remote: "origin",
        branch: "main",
        push: input.push,
        commitMessageTemplate: input.commitMessageTemplate ?? "backup memory {memoryId}",
      },
    },
  };
}

function createJob(input: {
  contentPaths: string[];
  reason?: MemoryBackupJob["reason"];
}): MemoryBackupJob {
  return {
    memoryId,
    contentPaths: input.contentPaths,
    reason: input.reason ?? "memory_creation",
  };
}

function initializeGitRepository(projectPath: string) {
  git(projectPath, ["init", "--initial-branch=main"]);
  git(projectPath, ["config", "user.name", "Trauma Tests"]);
  git(projectPath, ["config", "user.email", "trauma@example.invalid"]);
}

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: createChildEnv(),
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

function runBunScript(script: string, root: string) {
  try {
    return execFileSync("bun", ["-e", script], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...createChildEnv(),
        TRAUMA_TEST_ROOT: root,
      },
    });
  } catch (error) {
    if (!isSpawnMissing(error)) {
      throw error;
    }

    const repositoryRoot = process.cwd();
    return execFileSync(
      "mise",
      ["exec", "-C", repositoryRoot, "--", "bun", "-e", script],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...createChildEnv(),
          MISE_TRUSTED_CONFIG_PATHS: join(repositoryRoot, "mise.toml"),
          TRAUMA_TEST_ROOT: root,
        },
      },
    );
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

function createChildEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}

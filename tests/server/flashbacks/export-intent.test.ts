import { execFileSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createGitMemoryBackupQueue,
  getMemoryBackupQueue,
} from "../../../src/server/backup";
import type { ResolvedTraumaConfig } from "../../../src/server/config";
import { initializeDatabase, schema } from "../../../src/server/db";
import {
  persistFlashbackExportReconciliationIntent,
  recoverFlashbackExportReconciliationIntents,
} from "../../../src/server/flashbacks/export-intent";
import {
  createMemoryContentFixture,
  writeMemoryContent,
} from "../../../src/server/store";
import { createSha256ContentHash } from "../../../src/server/translation/hash";
import {
  BRILLIANT_CHUNKER_VERSION,
  BRILLIANT_PROMPT_POLICY_VERSION,
} from "../../../src/server/translation/prompt";
import { resolveTranslatedMemoryContentPath } from "../../../src/server/translation/paths";

const tempDirs: string[] = [];
const connections: Array<ReturnType<typeof initializeDatabase>> = [];

afterEach(async () => {
  for (const connection of connections.splice(0)) {
    connection.close();
  }
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe("Flashback export reconciliation intent", () => {
  it("recovers authoritative non-empty rows in a restarted process", async () => {
    const fixture = await createFixture(false);
    await fixture.connection.db.insert(schema.flashbacks).values({
      id: "flashback-recovered",
      memoryId: fixture.memoryId,
      text: "target",
      prefix: "Alpha ",
      suffix: " beta.",
      startOffset: 6,
      endOffset: 12,
      contentHash: null,
      createdAt: fixture.now,
      updatedAt: fixture.now,
    });
    await persistSourceIntent(fixture);
    fixture.connection.close();
    connections.splice(connections.indexOf(fixture.connection), 1);

    expect(runRecoveryInFreshProcess(fixture.config)).toBe(1);

    await expect(readExportIds(fixture)).resolves.toEqual([
      "flashback-recovered",
    ]);
    await expect(readIntentFilenames(fixture)).resolves.toEqual([]);
  });

  it("publishes an authoritative empty export even when no export exists", async () => {
    const fixture = await createFixture(false);
    await persistSourceIntent(fixture);

    await expect(recoverFixture(fixture)).resolves.toBe(1);

    await expect(readExportIds(fixture)).resolves.toEqual([]);
    await expect(readIntentFilenames(fixture)).resolves.toEqual([]);
  });

  it("clears an orphaned intent without recreating a deleted memory directory", async () => {
    const fixture = await createFixture(false);
    await fixture.connection.repositories.memories.deleteMemoryRecord(
      fixture.memoryId,
    );
    await rm(join(
      fixture.config.storePath,
      "memories",
      fixture.memoryId,
    ), { recursive: true, force: true });
    await persistSourceIntent(fixture);

    await expect(recoverFixture(fixture)).resolves.toBe(1);

    await expect(access(join(
      fixture.config.storePath,
      "memories",
      fixture.memoryId,
    ))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readIntentFilenames(fixture)).resolves.toEqual([]);
  });

  it("retains an intent after publication failure and clears it only after retry succeeds", async () => {
    const fixture = await createFixture(false);
    await persistSourceIntent(fixture);

    await expect(recoverFlashbackExportReconciliationIntents({
      config: fixture.config,
      fileSystem: failingExportFileSystem(),
      repositories: fixture.connection.repositories,
    })).rejects.toThrow("simulated export sync failure");
    await expect(readIntentFilenames(fixture)).resolves.toHaveLength(1);

    await expect(recoverFixture(fixture)).resolves.toBe(1);
    await expect(readExportIds(fixture)).resolves.toEqual([]);
    await expect(readIntentFilenames(fixture)).resolves.toEqual([]);
  });

  it("reconciles a stale translated intent to the current language output variant", async () => {
    const fixture = await createFixture(false);
    const currentOutputHash = await seedCurrentTranslation(fixture);
    await fixture.connection.db.insert(schema.flashbacks).values({
      id: "flashback-current-translation",
      memoryId: fixture.memoryId,
      variantKind: "translation",
      langCode: "ja-JP",
      translationOutputHash: currentOutputHash,
      text: "翻訳",
      prefix: "",
      suffix: "済み",
      startOffset: 0,
      endOffset: 2,
      contentHash: currentOutputHash,
      createdAt: fixture.now,
      updatedAt: fixture.now,
    });
    await persistFlashbackExportReconciliationIntent({
      config: fixture.config,
      memoryId: fixture.memoryId,
      variant: {
        kind: "translation",
        langCode: "ja-JP",
        outputHash: `sha256:${"f".repeat(64)}`,
      },
    });

    await expect(recoverFixture(fixture)).resolves.toBe(1);

    const payload = JSON.parse(await readFile(join(
      fixture.config.storePath,
      "memories",
      fixture.memoryId,
      "ja-JP",
      "FLASHBACKS.json",
    ), "utf8")) as {
      variant: { translationOutputHash: string };
      flashbacks: Array<{ id: string }>;
    };
    expect(payload).toMatchObject({
      variant: { translationOutputHash: currentOutputHash },
      flashbacks: [{ id: "flashback-current-translation" }],
    });
    await expect(readIntentFilenames(fixture)).resolves.toEqual([]);
  });

  it("publishes an authoritative empty translated export", async () => {
    const fixture = await createFixture(false);
    const currentOutputHash = await seedCurrentTranslation(fixture);
    await persistFlashbackExportReconciliationIntent({
      config: fixture.config,
      memoryId: fixture.memoryId,
      variant: {
        kind: "translation",
        langCode: "ja-JP",
        outputHash: currentOutputHash,
      },
    });

    await expect(recoverFixture(fixture)).resolves.toBe(1);

    const payload = JSON.parse(await readFile(join(
      fixture.config.storePath,
      "memories",
      fixture.memoryId,
      "ja-JP",
      "FLASHBACKS.json",
    ), "utf8")) as {
      variant: { translationOutputHash: string };
      flashbacks: unknown[];
    };
    expect(payload).toMatchObject({
      variant: { translationOutputHash: currentOutputHash },
      flashbacks: [],
    });
    await expect(readIntentFilenames(fixture)).resolves.toEqual([]);
  });

  it("runs reconciliation during backup-disabled startup", async () => {
    const fixture = await createFixture(false);
    await persistSourceIntent(fixture);

    getMemoryBackupQueue(fixture.config);

    await waitForPath(fixture.exportPath);
    await expect(readExportIds(fixture)).resolves.toEqual([]);
    await expect(readIntentFilenames(fixture)).resolves.toEqual([]);
  });

  it("runs reconciliation before backup-enabled Git failsafe validation", async () => {
    const fixture = await createFixture(true);
    await persistSourceIntent(fixture);
    const queue = createGitMemoryBackupQueue({
      config: fixture.config,
      runJob: async () => undefined,
    });

    await expect(queue.retryEligibleBackups()).rejects.toThrow();

    await expect(readExportIds(fixture)).resolves.toEqual([]);
    await expect(readIntentFilenames(fixture)).resolves.toEqual([]);
  });
});

interface Fixture {
  config: ResolvedTraumaConfig;
  connection: ReturnType<typeof initializeDatabase>;
  exportPath: string;
  memoryId: string;
  now: Date;
}

async function createFixture(backupEnabled: boolean): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "trauma-flashback-intent-"));
  tempDirs.push(root);
  const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f424";
  const now = new Date("2026-05-11T00:00:00.000Z");
  const config: ResolvedTraumaConfig = {
    configFilePath: join(root, "trauma.config.json"),
    projectPath: join(root, "data"),
    storePath: join(root, "data/store"),
    databasePath: join(root, ".trauma/trauma.sqlite"),
    backup: {
      git: {
        enabled: backupEnabled,
        remote: "origin",
        branch: "main",
        push: false,
        commitMessageTemplate: "backup memory {memoryId}",
      },
    },
  };
  const connection = initializeDatabase(config);
  connections.push(connection);
  await connection.repositories.memories.create({
    id: memoryId,
    url: "https://example.com/flashback-intent",
    title: "Flashback intent",
    description: null,
    faviconUrl: null,
    contentPath: `memories/${memoryId}/CONTENT.md`,
    extractionStatus: "success",
    extractionError: null,
    backupStatus: backupEnabled ? "pending" : "disabled",
    lastBackupAt: null,
    lastBackupError: null,
    createdAt: now,
    updatedAt: now,
  });
  await writeMemoryContent({
    config,
    memoryId,
    frontmatter: {
      id: memoryId,
      url: "https://example.com/flashback-intent",
      title: "Flashback intent",
      capturedAt: now.toISOString(),
      extractionStatus: "success",
    },
    markdown: "Alpha target beta.",
  });
  return {
    config,
    connection,
    exportPath: join(config.storePath, "memories", memoryId, "FLASHBACKS.json"),
    memoryId,
    now,
  };
}

async function persistSourceIntent(fixture: Fixture): Promise<void> {
  await persistFlashbackExportReconciliationIntent({
    config: fixture.config,
    memoryId: fixture.memoryId,
    variant: { kind: "source" },
  });
}

async function seedCurrentTranslation(fixture: Fixture): Promise<string> {
  const translatedPath = resolveTranslatedMemoryContentPath({
    config: fixture.config,
    langCode: "ja-JP",
    memoryId: fixture.memoryId,
  });
  await mkdir(dirname(translatedPath.absolutePath), { recursive: true });
  await writeFile(
    translatedPath.absolutePath,
    createMemoryContentFixture({
      frontmatter: {
        id: fixture.memoryId,
        url: "https://example.com/flashback-intent",
        title: "Flashback intent",
        capturedAt: fixture.now.toISOString(),
        extractionStatus: "success",
      },
      markdown: "翻訳済み",
    }),
    "utf8",
  );
  const sourceHash = createSha256ContentHash(await readFile(join(
    fixture.config.storePath,
    "memories",
    fixture.memoryId,
    "CONTENT.md",
  )));
  const outputHash = createSha256ContentHash(
    await readFile(translatedPath.absolutePath),
  );
  await fixture.connection.db.insert(schema.translationJobs).values({
    jobId: "019e3906-0000-7000-8000-000000000991",
    memoryId: fixture.memoryId,
    langCode: "ja-JP",
    sourceHash,
    model: null,
    reasoningEffort: null,
    promptPolicyVersion: BRILLIANT_PROMPT_POLICY_VERSION,
    chunkerVersion: BRILLIANT_CHUNKER_VERSION,
    status: "complete",
    chunkCount: 1,
    outputPath: translatedPath.relativePath,
    outputHash,
    error: null,
    completedAt: fixture.now,
    createdAt: fixture.now,
    updatedAt: fixture.now,
  });
  return outputHash;
}

async function recoverFixture(fixture: Fixture): Promise<number> {
  return recoverFlashbackExportReconciliationIntents({
    config: fixture.config,
    repositories: fixture.connection.repositories,
  });
}

async function readExportIds(fixture: Fixture): Promise<string[]> {
  const payload = JSON.parse(await readFile(fixture.exportPath, "utf8")) as {
    flashbacks: Array<{ id: string }>;
  };
  return payload.flashbacks.map((flashback) => flashback.id);
}

async function readIntentFilenames(fixture: Fixture): Promise<string[]> {
  return readdir(join(
    fixture.config.storePath,
    ".operations",
    "flashback-exports",
  ));
}

async function waitForPath(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await access(path);
      return;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function runRecoveryInFreshProcess(config: ResolvedTraumaConfig): number {
  const output = execFileSync(process.execPath, [
    "-e",
    `
      import { initializeDatabase } from "./src/server/db/index.ts";
      import { recoverFlashbackExportReconciliationIntents } from "./src/server/flashbacks/export-intent.ts";

      const config = JSON.parse(process.env.TRAUMA_FLASHBACK_RECOVERY_CONFIG ?? "null");
      if (config === null) {
        throw new Error("TRAUMA_FLASHBACK_RECOVERY_CONFIG is required");
      }
      const connection = initializeDatabase(config);
      try {
        const recovered = await recoverFlashbackExportReconciliationIntents({
          config,
          repositories: connection.repositories,
        });
        process.stdout.write(String(recovered));
      } finally {
        connection.close();
      }
    `,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      TRAUMA_FLASHBACK_RECOVERY_CONFIG: JSON.stringify(config),
    },
  });
  return Number(output);
}

function failingExportFileSystem() {
  return {
    mkdir: (path: string, options: { recursive: true }) => mkdir(path, options),
    open: async (path: string, flags: "wx", mode: number) => {
      const handle = await open(path, flags, mode);
      return {
        writeFile: (data: string, options: BufferEncoding) =>
          handle.writeFile(data, options),
        sync: async () => {
          throw Object.assign(new Error("simulated export sync failure"), {
            code: "EIO",
          });
        },
        close: () => handle.close(),
      };
    },
    openDirectory: async (path: string) => open(path, "r"),
    readFile: (path: string, options: BufferEncoding) => readFile(path, options),
    realpath,
    rename,
    rm: (path: string, options: { force: boolean }) => rm(path, options),
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

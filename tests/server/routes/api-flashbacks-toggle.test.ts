import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { APIEvent } from "@solidjs/start/server";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseFlashbackTogglePayload,
  POST,
} from "../../../src/routes/api/flashbacks";
import { loadTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";
import { writeMemoryContent } from "../../../src/server/store";

const originalEnv = { ...process.env };
const tempDirs: string[] = [];
const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f301";
const now = new Date("2026-05-13T00:00:00.000Z");

afterEach(async () => {
  process.env = { ...originalEnv };
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("flashbacks API route", () => {
  it("validates and preserves a reader selection payload", async () => {
    const result = await parseFlashbackTogglePayload(
      new Request("http://localhost/api/flashbacks", {
        method: "POST",
        body: JSON.stringify({
          memoryId: " 018f04a2-3c6f-7c88-9a8b-8c99a9b7f301 ",
          operation: "flashback",
          selection: {
            text: "target",
            prefix: "Beta ",
            suffix: " appears",
            startOffset: 53,
            endOffset: 59,
          },
        }),
      }),
    );

    expect(result).toEqual({
      ok: true,
      memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f301",
      operation: "flashback",
      selection: {
        text: "target",
        prefix: "Beta ",
        suffix: " appears",
        startOffset: 53,
        endOffset: 59,
      },
    });
  });

  it("rejects malformed or over-posted selection payloads", async () => {
    await expectPayloadError(
      {
        memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f301",
        operation: "flashback",
        selection: {
          text: "target",
          prefix: "",
          suffix: "",
          startOffset: 53,
          endOffset: 53,
          extra: true,
        },
      },
      "selection must contain only text, prefix, suffix, startOffset, and endOffset",
    );
  });

  it("rejects flashback writes while backup failsafe is active", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root);
    process.env.TRAUMA_CONFIG_PATH = configPath;
    const config = loadTraumaConfig({ configPath });
    const markdown = "Alpha target appears in the opening paragraph.";
    await writeMemoryContent({
      config,
      memoryId,
      frontmatter: {
        id: memoryId,
        url: "https://example.com/flashback",
        title: "Flashback",
        capturedAt: now.toISOString(),
        extractionStatus: "success",
      },
      markdown,
    });
    await seedPathDrift(configPath, root);

    const response = await POST(
      createApiEvent(
        new Request("http://localhost/api/flashbacks", {
          method: "POST",
          body: JSON.stringify({
            memoryId,
            operation: "flashback",
            selection: {
              text: "target",
              prefix: "Alpha ",
              suffix: " appears",
              startOffset: "Alpha ".length,
              endOffset: "Alpha target".length,
            },
          }),
        }),
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: "Backup location changed",
      backupFailsafe: {
        kind: "backup_path_drift",
        currentProjectPath: config.projectPath,
        currentStorePath: config.storePath,
      },
    });
    expect(await readFile(join(config.storePath, "memories", memoryId, "CONTENT.md"), "utf8"))
      .not.toContain("<mark data-flashback-id");
  });
});

async function expectPayloadError(payload: unknown, error: string): Promise<void> {
  await expect(
    parseFlashbackTogglePayload(
      new Request("http://localhost/api/flashbacks", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    ),
  ).resolves.toEqual({ ok: false, error });
}

function createApiEvent(request: Request): APIEvent {
  return {
    request,
    params: {},
    response: new Response(),
    locals: {},
    nativeEvent: {},
  } as unknown as APIEvent;
}

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "trauma-api-flashbacks-"));
  tempDirs.push(root);
  return root;
}

async function writeConfig(root: string) {
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
            push: false,
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

async function seedPathDrift(configPath: string, root: string) {
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
    await connection.repositories.memories.create({
      id: memoryId,
      url: "https://example.com/flashback",
      title: "Flashback",
      description: null,
      faviconUrl: null,
      contentPath: `memories/${memoryId}/CONTENT.md`,
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "success",
      lastBackupAt: now,
      lastBackupError: null,
      createdAt: now,
      updatedAt: now,
    });
  } finally {
    connection.close();
  }
}

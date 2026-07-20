import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { APIEvent } from "@solidjs/start/server";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseFlashbackTogglePayload,
  POST,
  readTranslatedFlashbackContentForOutput,
} from "../../../src/routes/api/flashbacks";
import { loadTraumaConfig } from "../../../src/server/config";
import { initializeDatabase, schema } from "../../../src/server/db";
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

  it("accepts an optional translated reader language for flashback projection", async () => {
    const result = await parseFlashbackTogglePayload(
      new Request("http://localhost/api/flashbacks", {
        method: "POST",
        body: JSON.stringify({
          memoryId,
          langCode: "ja-JP",
          operation: "flashback",
          selection: {
            text: "翻訳文",
            prefix: "",
            suffix: "",
            startOffset: 0,
            endOffset: 3,
          },
        }),
      }),
    );

    expect(result).toEqual({
      ok: true,
      langCode: "ja-JP",
      memoryId,
      operation: "flashback",
      selection: {
        text: "翻訳文",
        prefix: "",
        suffix: "",
        startOffset: 0,
        endOffset: 3,
      },
    });
  });

  it("rejects invalid translated reader language codes", async () => {
    await expectPayloadError(
      {
        memoryId,
        langCode: "xx",
        operation: "flashback",
        selection: {
          text: "target",
          prefix: "",
          suffix: "",
          startOffset: 0,
          endOffset: 6,
        },
      },
      "langCode must be a supported translation language",
    );
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
        availableActions: ["revert", "migrate"],
      },
    });
    expect(JSON.stringify(body)).not.toContain(config.projectPath);
    expect(JSON.stringify(body)).not.toContain(config.storePath);
    expect(await readFile(join(config.storePath, "memories", memoryId, "CONTENT.md"), "utf8"))
      .not.toContain("<mark data-flashback-id");
  });

  it("stores translated reader flashback selections as translated variant rows", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root, { backupEnabled: false });
    process.env.TRAUMA_CONFIG_PATH = configPath;
    const config = loadTraumaConfig({ configPath });
    const sourceMarkdown = "Or as Jean Baudrillard has said:";
    const translatedMarkdown = "あるいは、ジャン・ボードリヤールが言ったように：";
    await seedTranslatedFlashbackFixture({
      config,
      sourceMarkdown,
      translatedMarkdown,
    });

    const selected = "ジャン・ボードリヤール";
    const startOffset = translatedMarkdown.indexOf(selected);
    const response = await POST(
      createApiEvent(
        new Request("http://localhost/api/flashbacks", {
          method: "POST",
          body: JSON.stringify({
            memoryId,
            langCode: "ja-JP",
            operation: "flashback",
            selection: {
              text: selected,
              prefix: translatedMarkdown.slice(0, startOffset),
              suffix: translatedMarkdown.slice(startOffset + selected.length),
              startOffset,
              endOffset: startOffset + selected.length,
            },
          }),
        }),
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.flashbacks).toEqual([
      expect.objectContaining({
        text: selected,
        startOffset,
        endOffset: startOffset + selected.length,
      }),
    ]);

    const connection = initializeDatabase(config);
    try {
      await expect(
        connection.repositories.flashbacks.listForMemory(memoryId),
      ).resolves.toEqual([]);
      const rows = connection.sqlite
        .prepare(
          "select text, variant_kind as variantKind, lang_code as langCode, translation_output_hash as translationOutputHash from flashbacks where memory_id = ? order by start_offset",
        )
        .all(memoryId);
      expect(rows).toEqual([
        expect.objectContaining({
          text: selected,
          variantKind: "translation",
          langCode: "ja-JP",
          translationOutputHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        }),
      ]);
    } finally {
      connection.close();
    }
  });

  it("returns exact committed durability warning JSON without internal diagnostics", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root, { backupEnabled: false });
    process.env.TRAUMA_CONFIG_PATH = configPath;
    const config = loadTraumaConfig({ configPath });
    const markdown = "Alpha target beta.";
    const connection = initializeDatabase(config);
    try {
      await connection.repositories.memories.create({
        id: memoryId,
        url: "https://example.com/flashback-warning",
        title: "Flashback warning",
        description: null,
        faviconUrl: null,
        contentPath: `memories/${memoryId}/CONTENT.md`,
        extractionStatus: "success",
        extractionError: null,
        backupStatus: "disabled",
        lastBackupAt: null,
        lastBackupError: null,
        createdAt: now,
        updatedAt: now,
      });
      await connection.db.insert(schema.flashbacks).values({
        id: "flashback-warning-existing",
        memoryId,
        text: "target",
        prefix: "Alpha ",
        suffix: " beta.",
        startOffset: 6,
        endOffset: 12,
        contentHash: null,
        createdAt: now,
        updatedAt: now,
      });
    } finally {
      connection.close();
    }
    await writeMemoryContent({
      config,
      memoryId,
      frontmatter: {
        id: memoryId,
        url: "https://example.com/flashback-warning",
        title: "Flashback warning",
        capturedAt: now.toISOString(),
        extractionStatus: "success",
      },
      markdown,
    });

    const response = await POST(
      createApiEvent(
        new Request("http://localhost/api/flashbacks", {
          method: "POST",
          body: JSON.stringify({
            memoryId,
            operation: "unflashback",
            selection: {
              text: "target",
              prefix: "Alpha ",
              suffix: " beta.",
              startOffset: 6,
              endOffset: 12,
            },
          }),
        }),
      ),
      { flashbackExportFileSystem: unconfirmedExportFileSystem() },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      result: {
        operation: "unflashbacked",
        durability: {
          status: "unconfirmed",
          warning: {
            code: "flashback_export_durability_unconfirmed",
            message:
              "Flashback change was saved, but export durability could not be confirmed.",
          },
        },
        flashbacks: [],
      },
    });
    expect(JSON.stringify(body)).not.toContain(config.storePath);
    expect(JSON.stringify(body)).not.toContain("targetMatchesExpected");
    expect(JSON.stringify(body)).not.toContain("private sync failure");
    expect(JSON.stringify(body)).not.toContain("cause");
  });

  it("rejects translated flashback content when the file no longer matches the resolved output hash", async () => {
    const root = await makeRoot();
    const configPath = await writeConfig(root, { backupEnabled: false });
    const config = loadTraumaConfig({ configPath });
    const translatedPath = resolveTranslatedMemoryContentPath({
      config,
      langCode: "ja-JP",
      memoryId,
    });
    await mkdir(dirname(translatedPath.absolutePath), { recursive: true });
    await writeFile(
      translatedPath.absolutePath,
      createMemoryContentFixture({
        frontmatter: {
          id: memoryId,
          url: "https://example.com/flashback",
          title: "Flashback",
          capturedAt: now.toISOString(),
          extractionStatus: "success",
        },
        markdown: "更新後の翻訳文",
      }),
      "utf8",
    );

    await expect(
      readTranslatedFlashbackContentForOutput({
        contentPath: translatedPath,
        outputHash: `sha256:${"0".repeat(64)}`,
      }),
    ).rejects.toMatchObject({
      code: "translation_unavailable",
    });
  });
});

function unconfirmedExportFileSystem() {
  return {
    mkdir: (path: string, options: { recursive: true }) => mkdir(path, options),
    open: (path: string, flags: "wx", mode: number) => open(path, flags, mode),
    openDirectory: async (path: string) => {
      const handle = await open(path, "r");
      return {
        close: () => handle.close(),
        sync: async () => {
          throw Object.assign(new Error("private sync failure"), {
            code: "EIO",
          });
        },
      };
    },
    readFile: (path: string, encoding: BufferEncoding) => readFile(path, encoding),
    realpath,
    rename,
    rm: (path: string, options: { force: boolean }) => rm(path, options),
  };
}

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

async function writeConfig(
  root: string,
  options: { backupEnabled?: boolean } = {},
) {
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
            enabled: options.backupEnabled ?? true,
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

async function seedTranslatedFlashbackFixture(input: {
  config: ReturnType<typeof loadTraumaConfig>;
  sourceMarkdown: string;
  translatedMarkdown: string;
}) {
  const connection = initializeDatabase(input.config);
  try {
    await connection.repositories.memories.create({
      id: memoryId,
      url: "https://example.com/flashback",
      title: "Flashback",
      description: null,
      faviconUrl: null,
      contentPath: `memories/${memoryId}/CONTENT.md`,
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "disabled",
      lastBackupAt: null,
      lastBackupError: null,
      createdAt: now,
      updatedAt: now,
    });
  } finally {
    connection.close();
  }

  await writeMemoryContent({
    config: input.config,
    memoryId,
    frontmatter: {
      id: memoryId,
      url: "https://example.com/flashback",
      title: "Flashback",
      capturedAt: now.toISOString(),
      extractionStatus: "success",
    },
    markdown: input.sourceMarkdown,
  });

  const translatedPath = resolveTranslatedMemoryContentPath({
    config: input.config,
    langCode: "ja-JP",
    memoryId,
  });
  await mkdir(dirname(translatedPath.absolutePath), { recursive: true });
  await writeFile(
    translatedPath.absolutePath,
    createMemoryContentFixture({
      frontmatter: {
        id: memoryId,
        url: "https://example.com/flashback",
        title: "Flashback",
        capturedAt: now.toISOString(),
        extractionStatus: "success",
      },
      markdown: input.translatedMarkdown,
    }),
    "utf8",
  );

  const sourceHash = createSha256ContentHash(
    await readFile(join(input.config.storePath, "memories", memoryId, "CONTENT.md")),
  );
  const outputHash = createSha256ContentHash(
    await readFile(translatedPath.absolutePath),
  );
  const dbConnection = initializeDatabase(input.config);
  try {
    await dbConnection.db.insert(schema.translationJobs).values({
      jobId: "019e3906-0000-7000-8000-000000000902",
      memoryId,
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
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await dbConnection.db.insert(schema.translationProjectionSpans).values({
      jobId: "019e3906-0000-7000-8000-000000000902",
      spanIndex: 0,
      memoryId,
      langCode: "ja-JP",
      sourceHash,
      outputHash,
      blockId: "b000001",
      segmentId: "s000001",
      sourceMarkdownStart: 0,
      sourceMarkdownEnd: input.sourceMarkdown.length,
      sourceReaderStart: 0,
      sourceReaderEnd: input.sourceMarkdown.length,
      translatedMarkdownStart: 0,
      translatedMarkdownEnd: input.translatedMarkdown.length,
      translatedReaderStart: 0,
      translatedReaderEnd: input.translatedMarkdown.length,
      createdAt: now,
      updatedAt: now,
    });
  } finally {
    dbConnection.close();
  }
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

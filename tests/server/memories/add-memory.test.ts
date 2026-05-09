import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const successMemoryId = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef111";
const fallbackMemoryId = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef112";
const capturedAt = new Date("2026-05-09T06:00:00.000Z");

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("add memory orchestration", () => {
  it("creates SQLite metadata, writes markdown, and enqueues backup after successful extraction", async () => {
    const root = await makeRoot();
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { addMemory } from "./src/server/memories/add-memory.ts";
        import { readMemoryContent } from "./src/server/store/memory-content.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const config = createConfig(root);
        const connection = initializeDatabase(config);
        const enqueued = [];

        try {
          const result = await addMemory({
            url: "https://example.com/article",
            config,
            db: connection.db,
            importer: {
              importUrl: async () => ({
                status: "success",
                url: "https://example.com/article",
                title: "Extracted Title",
                description: "Extracted description",
                faviconUrl: "https://example.com/favicon.ico",
                markdown: "# Extracted Title\\n\\nImported markdown body.",
              }),
            },
            backupQueue: {
              enqueue: async (input) => {
                enqueued.push(input);
                return { backupStatus: "queued" };
              },
            },
            generateId: () => ${JSON.stringify(successMemoryId)},
            now: () => new Date(${JSON.stringify(capturedAt.toISOString())}),
          });
          const stored = await connection.repositories.memories.findById(${JSON.stringify(successMemoryId)});
          const content = await readMemoryContent({
            config: { storePath: config.storePath },
            memoryId: ${JSON.stringify(successMemoryId)},
          });

          process.stdout.write(JSON.stringify({ result, stored, content, enqueued }));
        } finally {
          connection.close();
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
    const { result, stored, content, enqueued } = JSON.parse(output);

    expect(result).toMatchObject({
      id: successMemoryId,
      title: "Extracted Title",
      extractionStatus: "success",
      backupStatus: "queued",
    });

    expect(stored).toMatchObject({
      id: successMemoryId,
      url: "https://example.com/article",
      title: "Extracted Title",
      description: "Extracted description",
      faviconUrl: "https://example.com/favicon.ico",
      contentPath: `memories/${successMemoryId}/CONTENT.md`,
      extractionStatus: "success",
      extractionError: null,
      backupStatus: "queued",
    });

    expect(content.frontmatter).toEqual({
      id: successMemoryId,
      url: "https://example.com/article",
      title: "Extracted Title",
      capturedAt: "2026-05-09T06:00:00.000Z",
      extractionStatus: "success",
    });
    expect(content.markdown).toBe(
      "# Extracted Title\n\nImported markdown body.",
    );
    expect(content.markdown).not.toContain("<html");
    expect(enqueued).toEqual([
      {
        memoryId: successMemoryId,
        contentPath: `memories/${successMemoryId}/CONTENT.md`,
      },
    ]);
  });

  it("creates a link-only memory when extraction falls back", async () => {
    const root = await makeRoot();
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { addMemory } from "./src/server/memories/add-memory.ts";
        import { readMemoryContent } from "./src/server/store/memory-content.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const config = createConfig(root);
        const connection = initializeDatabase(config);
        const enqueued = [];

        try {
          await addMemory({
            url: "https://example.com/wiki/Foo_(bar)?q=]",
            config,
            db: connection.db,
            importer: {
              importUrl: async () => ({
                status: "link_only",
                url: "https://example.com/wiki/Foo_(bar)?q=]",
                title: "example.com",
                extractionError: "fetch failed: network unavailable",
              }),
            },
            backupQueue: {
              enqueue: async (input) => {
                enqueued.push(input);
                return { backupStatus: "queued" };
              },
            },
            generateId: () => ${JSON.stringify(fallbackMemoryId)},
            now: () => new Date(${JSON.stringify(capturedAt.toISOString())}),
          });
          const stored = await connection.repositories.memories.findById(${JSON.stringify(fallbackMemoryId)});
          const content = await readMemoryContent({
            config: { storePath: config.storePath },
            memoryId: ${JSON.stringify(fallbackMemoryId)},
          });

          process.stdout.write(JSON.stringify({ stored, content, enqueued }));
        } finally {
          connection.close();
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
    const { stored, content, enqueued } = JSON.parse(output);

    expect(stored).toMatchObject({
      id: fallbackMemoryId,
      url: "https://example.com/wiki/Foo_(bar)?q=]",
      title: "example.com",
      description: null,
      faviconUrl: null,
      extractionStatus: "link_only",
      extractionError: "fetch failed: network unavailable",
      backupStatus: "queued",
    });

    expect(content.frontmatter.extractionStatus).toBe("link_only");
    expect(content.markdown).toBe(
      "[https://example.com/wiki/Foo_(bar)?q=\\]](<https://example.com/wiki/Foo_(bar)?q=]>)",
    );
    expect(enqueued).toHaveLength(1);
  });

  it("preserves memory creation and marks backup failed when enqueue fails", async () => {
    const root = await makeRoot();
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { addMemory } from "./src/server/memories/add-memory.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const config = createConfig(root);
        const connection = initializeDatabase(config);

        try {
          const result = await addMemory({
            url: "https://example.com/backup-fails",
            config,
            db: connection.db,
            importer: {
              importUrl: async () => ({
                status: "success",
                url: "https://example.com/backup-fails",
                title: "Backup Fails",
                description: null,
                faviconUrl: null,
                markdown: "# Backup Fails\\n\\nImported markdown body.",
              }),
            },
            backupQueue: {
              enqueue: async () => {
                throw new Error("queue unavailable");
              },
            },
            generateId: () => ${JSON.stringify("018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef113")},
            now: () => new Date(${JSON.stringify(capturedAt.toISOString())}),
          });

          process.stdout.write(JSON.stringify({ result }));
        } finally {
          connection.close();
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
    const { result } = JSON.parse(output);

    expect(result).toMatchObject({
      id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef113",
      backupStatus: "failed",
      lastBackupError: "queue unavailable",
    });
  });

  it("returns the created memory when queued-status persistence fails after insert", async () => {
    const root = await makeRoot();
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { addMemory } from "./src/server/memories/add-memory.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const config = createConfig(root);
        const connection = initializeDatabase(config);

        try {
          const originalRun = connection.db.update;
          let shouldFailBackupUpdate = false;
          connection.db.update = (...args) => {
            if (shouldFailBackupUpdate) {
              throw new Error("backup update unavailable");
            }

            return originalRun.call(connection.db, ...args);
          };

          const result = await addMemory({
            url: "https://example.com/update-fails",
            config,
            db: connection.db,
            importer: {
              importUrl: async () => ({
                status: "success",
                url: "https://example.com/update-fails",
                title: "Backup Update Fails",
                description: null,
                faviconUrl: null,
                markdown: "# Backup Update Fails\\n\\nImported markdown body.",
              }),
            },
            backupQueue: {
              enqueue: async () => {
                shouldFailBackupUpdate = true;
                return { backupStatus: "queued" };
              },
            },
            generateId: () => ${JSON.stringify("018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef115")},
            now: () => new Date(${JSON.stringify(capturedAt.toISOString())}),
          });
          const stored = await connection.repositories.memories.findById(${JSON.stringify("018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef115")});

          process.stdout.write(JSON.stringify({ result, stored }));
        } finally {
          connection.close();
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
    const { result, stored } = JSON.parse(output);

    expect(result).toMatchObject({
      id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef115",
      backupStatus: "pending",
      lastBackupError: null,
    });
    expect(stored).toMatchObject({
      id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef115",
      backupStatus: "pending",
    });
  });

  it("does not delete content when post-insert read-back is unavailable", async () => {
    const root = await makeRoot();
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { addMemory } from "./src/server/memories/add-memory.ts";
        import { readMemoryContent } from "./src/server/store/memory-content.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const config = createConfig(root);
        const connection = initializeDatabase(config);

        try {
          connection.db.query.memories.findFirst = async () => {
            throw new Error("read-back unavailable");
          };

          const memoryId = ${JSON.stringify("018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef116")};
          const result = await addMemory({
            url: "https://example.com/readback-fails",
            config,
            db: connection.db,
            importer: {
              importUrl: async () => ({
                status: "success",
                url: "https://example.com/readback-fails",
                title: "Readback Fails",
                description: null,
                faviconUrl: null,
                markdown: "# Readback Fails\\n\\nImported markdown body.",
              }),
            },
            backupQueue: {
              enqueue: async () => {
                throw new Error("backup should be disabled");
              },
            },
            generateId: () => memoryId,
            now: () => new Date(${JSON.stringify(capturedAt.toISOString())}),
          });
          const stored = connection.sqlite
            .prepare("select id, content_path as contentPath from memories where id = ?")
            .get(memoryId);
          const content = await readMemoryContent({
            config: { storePath: config.storePath },
            memoryId,
          });

          process.stdout.write(JSON.stringify({ result, stored, content }));
        } finally {
          connection.close();
        }

        function createConfig(root) {
          return {
            configFilePath: join(root, "trauma.config.json"),
            projectPath: join(root, "data"),
            storePath: join(root, "data/store"),
            databasePath: join(root, ".trauma/trauma.sqlite"),
            backup: {
              git: {
                enabled: false,
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
    const { result, stored, content } = JSON.parse(output);

    expect(result).toMatchObject({
      id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef116",
      backupStatus: "disabled",
    });
    expect(stored).toEqual({
      id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef116",
      contentPath: "memories/018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef116/CONTENT.md",
    });
    expect(content.markdown).toBe(
      "# Readback Fails\n\nImported markdown body.",
    );
  });

  it("leaves backup pending when the no-op queue boundary is used", async () => {
    const root = await makeRoot();
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { createNoopMemoryBackupQueue } from "./src/server/backup/index.ts";
        import { initializeDatabase } from "./src/server/db/index.ts";
        import { addMemory } from "./src/server/memories/add-memory.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const config = createConfig(root);
        const connection = initializeDatabase(config);

        try {
          const result = await addMemory({
            url: "https://example.com/noop-backup",
            config,
            db: connection.db,
            importer: {
              importUrl: async () => ({
                status: "success",
                url: "https://example.com/noop-backup",
                title: "Noop Backup",
                description: null,
                faviconUrl: null,
                markdown: "# Noop Backup\\n\\nImported markdown body.",
              }),
            },
            backupQueue: createNoopMemoryBackupQueue(),
            generateId: () => ${JSON.stringify("018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef114")},
            now: () => new Date(${JSON.stringify(capturedAt.toISOString())}),
          });

          process.stdout.write(JSON.stringify({ result }));
        } finally {
          connection.close();
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
    const { result } = JSON.parse(output);

    expect(result).toMatchObject({
      id: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef114",
      backupStatus: "pending",
      lastBackupError: null,
    });
  });
});

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "trauma-add-memory-"));
  tempDirs.push(root);
  return root;
}

function runBunScript(script: string, root: string) {
  try {
    return execFileSync("bun", ["-e", script], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
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
          ...process.env,
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

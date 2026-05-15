import { execFileSync } from "node:child_process";
import { accessSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

describe("memory and taxonomy repositories", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("defaults new memories to unread and toggles read status", () => {
    const root = createTempRoot(tempRoots);
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

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
          await connection.repositories.memories.create({
            id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f101",
            url: "https://example.com/read-status",
            title: "Read status",
            description: null,
            faviconUrl: null,
            contentPath: "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f101/CONTENT.md",
            extractionStatus: "success",
            extractionError: null,
            backupStatus: "disabled",
            lastBackupAt: null,
            lastBackupError: null,
            createdAt: now,
            updatedAt: now,
          });

          const created = await connection.repositories.memories.findById("018f04a2-3c6f-7c88-9a8b-8c99a9b7f101");
          const markedRead = await connection.repositories.memories.setReadStatus({
            memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f101",
            read: true,
            updatedAt: new Date("2026-05-10T02:00:00.000Z"),
          });
          const markedUnread = await connection.repositories.memories.setReadStatus({
            memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f101",
            read: false,
            updatedAt: new Date("2026-05-10T03:00:00.000Z"),
          });

          process.stdout.write(JSON.stringify({
            createdRead: created?.read,
            markedRead: markedRead?.read,
            markedUnread: markedUnread?.read,
            missingUpdate: await connection.repositories.memories.setReadStatus({
              memoryId: "missing-memory",
              read: true,
              updatedAt: now,
            }),
          }));
        } finally {
          connection.close();
        }
      `,
      { TRAUMA_TEST_ROOT: root },
    );

    expect(JSON.parse(output)).toEqual({
      createdRead: false,
      markedRead: true,
      markedUnread: false,
    });
  });

  it("creates and assigns taxonomy records idempotently", () => {
    const root = createTempRoot(tempRoots);
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

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
          const now = new Date("2026-05-10T01:00:00.000Z");
          const later = new Date("2026-05-11T01:00:00.000Z");
          await connection.repositories.memories.create({
            id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f102",
            url: "https://example.com/taxonomy",
            title: "Taxonomy",
            description: null,
            faviconUrl: null,
            contentPath: "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f102/CONTENT.md",
            extractionStatus: "success",
            extractionError: null,
            backupStatus: "disabled",
            lastBackupAt: null,
            lastBackupError: null,
            createdAt: now,
            updatedAt: now,
          });

          const tag = await connection.repositories.taxonomy.createTag({ id: "tag-sqlite", name: "sqlite", now });
          const duplicateTag = await connection.repositories.taxonomy.createTag({ id: "tag-other", name: "sqlite", now: later });
          const category = await connection.repositories.taxonomy.createCategory({ id: "category-research", name: "Research", now });
          const duplicateCategory = await connection.repositories.taxonomy.createCategory({ id: "category-other", name: "Research", now: later });
          await connection.repositories.taxonomy.createTag({ id: "tag-empty", name: "empty", now });
          await connection.repositories.taxonomy.createCategory({ id: "category-empty", name: "Empty", now });

          await connection.repositories.taxonomy.attachTagToMemory({
            memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f102",
            tagId: "tag-sqlite",
            now,
          });
          await connection.repositories.taxonomy.attachTagToMemory({
            memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f102",
            tagId: "tag-sqlite",
            now: later,
          });
          await connection.repositories.taxonomy.attachCategoryToMemory({
            memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f102",
            categoryId: "category-research",
            now,
          });
          await connection.repositories.taxonomy.attachCategoryToMemory({
            memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f102",
            categoryId: "category-research",
            now: later,
          });

          let missingError;
          try {
            await connection.repositories.taxonomy.attachTagToMemory({
              memoryId: "missing-memory",
              tagId: "tag-sqlite",
              now,
            });
          } catch (error) {
            missingError = error instanceof Error ? error.message : String(error);
          }

          process.stdout.write(JSON.stringify({
            tag,
            duplicateTag,
            category,
            duplicateCategory,
            tagAssignment: connection.sqlite.prepare("select created_at as createdAt, updated_at as updatedAt from memory_tags where memory_id = ? and tag_id = ?")
              .get("018f04a2-3c6f-7c88-9a8b-8c99a9b7f102", "tag-sqlite"),
            categoryAssignment: connection.sqlite.prepare("select created_at as createdAt, updated_at as updatedAt from memory_categories where memory_id = ? and category_id = ?")
              .get("018f04a2-3c6f-7c88-9a8b-8c99a9b7f102", "category-research"),
            tags: await connection.repositories.taxonomy.listTagsForBrowse(),
            categories: await connection.repositories.taxonomy.listCategoriesForBrowse(),
            missingError,
          }));
        } finally {
          connection.close();
        }
      `,
      { TRAUMA_TEST_ROOT: root },
    );

    expect(JSON.parse(output)).toMatchObject({
      tag: { id: "tag-sqlite", name: "sqlite" },
      duplicateTag: { id: "tag-sqlite", name: "sqlite" },
      category: { id: "category-research", name: "Research" },
      duplicateCategory: { id: "category-research", name: "Research" },
      tagAssignment: {
        createdAt: Date.parse("2026-05-10T01:00:00.000Z"),
        updatedAt: Date.parse("2026-05-11T01:00:00.000Z"),
      },
      categoryAssignment: {
        createdAt: Date.parse("2026-05-10T01:00:00.000Z"),
        updatedAt: Date.parse("2026-05-11T01:00:00.000Z"),
      },
      tags: [
        {
          id: "tag-sqlite",
          name: "sqlite",
          memoryCount: 1,
          lastAssignedAt: "2026-05-11T01:00:00.000Z",
        },
        {
          id: "tag-empty",
          name: "empty",
          memoryCount: 0,
          lastAssignedAt: null,
        },
      ],
      categories: [
        {
          id: "category-research",
          name: "Research",
          memoryCount: 1,
          lastAssignedAt: "2026-05-11T01:00:00.000Z",
        },
        {
          id: "category-empty",
          name: "Empty",
          memoryCount: 0,
          lastAssignedAt: null,
        },
      ],
      missingError: "Cannot attach tag to missing memory: missing-memory",
    });
  });

  it("creates, lists, and deletes Flashbacks idempotently", () => {
    const root = createTempRoot(tempRoots);
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

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
          const now = new Date("2026-05-10T01:00:00.000Z");
          const later = new Date("2026-05-10T02:00:00.000Z");
          await connection.repositories.memories.create({
            id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f104",
            url: "https://example.com/flashback",
            title: "Flashback Memory",
            description: null,
            faviconUrl: null,
            contentPath: "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f104/CONTENT.md",
            extractionStatus: "success",
            extractionError: null,
            backupStatus: "disabled",
            lastBackupAt: null,
            lastBackupError: null,
            createdAt: now,
            updatedAt: now,
          });

          const created = await connection.repositories.flashbacks.create({
            id: "flashback-1",
            memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f104",
            sectionAnchor: "chapter-one",
            sectionTitle: "Chapter One",
            sectionLevel: 2,
            sectionPath: "1/1",
            sectionStartOffset: null,
            sectionEndOffset: null,
            contentHash: null,
            createdAt: now,
            updatedAt: now,
          });
          const duplicate = await connection.repositories.flashbacks.create({
            id: "flashback-duplicate",
            memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f104",
            sectionAnchor: "chapter-one",
            sectionTitle: "Chapter One",
            sectionLevel: 2,
            sectionPath: "1/1",
            sectionStartOffset: null,
            sectionEndOffset: null,
            contentHash: null,
            createdAt: later,
            updatedAt: later,
          });
          const movedAnchor = await connection.repositories.flashbacks.create({
            id: "flashback-moved",
            memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f104",
            sectionAnchor: "chapter-one-renamed",
            sectionTitle: "Chapter One Renamed",
            sectionLevel: 2,
            sectionPath: "1/1",
            sectionStartOffset: null,
            sectionEndOffset: null,
            contentHash: "hash",
            createdAt: later,
            updatedAt: later,
          });
          const listed = await connection.repositories.flashbacks.listForBrowse();
          const deleted = await connection.repositories.flashbacks.deleteById("flashback-1");
          const missingDeleted = await connection.repositories.flashbacks.deleteById("missing-flashback");

          process.stdout.write(JSON.stringify({
            created,
            duplicate,
            movedAnchor,
            listed,
            deleted,
            missingDeleted,
            count: connection.sqlite.prepare("select count(*) as count from flashbacks").get().count,
          }));
        } finally {
          connection.close();
        }
      `,
      { TRAUMA_TEST_ROOT: root },
    );

    expect(JSON.parse(output)).toMatchObject({
      created: {
        alreadyExists: false,
        flashback: {
          id: "flashback-1",
          sectionAnchor: "chapter-one",
          sectionTitle: "Chapter One",
        },
      },
      duplicate: {
        alreadyExists: true,
        flashback: {
          id: "flashback-1",
          sectionAnchor: "chapter-one",
        },
      },
      movedAnchor: {
        alreadyExists: true,
        flashback: {
          id: "flashback-1",
          sectionAnchor: "chapter-one-renamed",
          sectionTitle: "Chapter One Renamed",
          contentHash: "hash",
        },
      },
      listed: [
        {
          id: "flashback-1",
          memoryTitle: "Flashback Memory",
          memoryUrl: "https://example.com/flashback",
          sectionAnchor: "chapter-one-renamed",
          sectionTitle: "Chapter One Renamed",
        },
      ],
      deleted: true,
      missingDeleted: false,
      count: 0,
    });
  });

  it("deletes memory rows while preserving global taxonomy records", () => {
    const root = createTempRoot(tempRoots);
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

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
          const now = new Date("2026-05-10T01:00:00.000Z");
          await connection.repositories.memories.create({
            id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f103",
            url: "https://example.com/delete",
            title: "Delete",
            description: null,
            faviconUrl: null,
            contentPath: "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f103/CONTENT.md",
            extractionStatus: "success",
            extractionError: null,
            backupStatus: "disabled",
            lastBackupAt: null,
            lastBackupError: null,
            createdAt: now,
            updatedAt: now,
          });
          await connection.repositories.taxonomy.createTag({ id: "tag-delete", name: "delete-tag", now });
          await connection.repositories.taxonomy.createCategory({ id: "category-delete", name: "Delete category", now });
          await connection.repositories.taxonomy.attachTagToMemory({
            memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f103",
            tagId: "tag-delete",
            now,
          });
          await connection.repositories.taxonomy.attachCategoryToMemory({
            memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f103",
            categoryId: "category-delete",
            now,
          });
          connection.sqlite.prepare("insert into highlights (id, memory_id, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run("highlight-delete", "018f04a2-3c6f-7c88-9a8b-8c99a9b7f103", "delete", "", "", 0, 6, now.getTime(), now.getTime());
          connection.sqlite.prepare("insert into flashbacks (id, memory_id, section_anchor, section_title, section_level, section_path, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
            .run("flashback-delete", "018f04a2-3c6f-7c88-9a8b-8c99a9b7f103", "chapter", "Chapter", 2, "1/1", now.getTime(), now.getTime());

          const target = await connection.repositories.memories.findDeletionTarget("018f04a2-3c6f-7c88-9a8b-8c99a9b7f103");
          const deleted = await connection.repositories.memories.deleteMemoryRecord("018f04a2-3c6f-7c88-9a8b-8c99a9b7f103");
          const missingDeleted = await connection.repositories.memories.deleteMemoryRecord("missing-memory");

          process.stdout.write(JSON.stringify({
            target,
            deleted,
            missingDeleted,
            memories: connection.sqlite.prepare("select count(*) as count from memories").get().count,
            flashbacks: connection.sqlite.prepare("select count(*) as count from flashbacks").get().count,
            highlights: connection.sqlite.prepare("select count(*) as count from highlights").get().count,
            memoryTags: connection.sqlite.prepare("select count(*) as count from memory_tags").get().count,
            memoryCategories: connection.sqlite.prepare("select count(*) as count from memory_categories").get().count,
            tags: connection.sqlite.prepare("select count(*) as count from tags").get().count,
            categories: connection.sqlite.prepare("select count(*) as count from categories").get().count,
          }));
        } finally {
          connection.close();
        }
      `,
      { TRAUMA_TEST_ROOT: root },
    );

    expect(JSON.parse(output)).toEqual({
      target: {
        id: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f103",
        contentPath: "memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f103/CONTENT.md",
      },
      deleted: true,
      missingDeleted: false,
      memories: 0,
      flashbacks: 0,
      highlights: 0,
      memoryTags: 0,
      memoryCategories: 0,
      tags: 1,
      categories: 1,
    });
  });
});

function createTempRoot(tempRoots: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "trauma-repositories-"));
  tempRoots.push(root);
  return root;
}

function runBunScript(script: string, env: Record<string, string>): string {
  const repositoryRoot = process.cwd();
  const cacheDir = join(repositoryRoot, ".tmp/bun-cache");
  const temporaryDir = join(repositoryRoot, ".tmp/bun-tmp");
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(temporaryDir, { recursive: true });

  return execFileSync(resolveBunExecutable(), ["-e", script], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      BUN_INSTALL_CACHE_DIR: cacheDir,
      TMPDIR: temporaryDir,
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
    throw new Error("Bun executable is required for repository tests");
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

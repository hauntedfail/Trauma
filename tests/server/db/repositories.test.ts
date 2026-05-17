import { execFileSync } from "node:child_process";
import { accessSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

describe("memory and taxonomy repositories", () => {
  const tempRoots: string[] = [];
  const repositorySource = readFileSync("src/server/db/repositories.ts", "utf8");

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

  it("rolls back taxonomy creation when create-and-attach fails", () => {
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
          const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f103";
          await connection.repositories.memories.create({
            id: memoryId,
            url: "https://example.com/taxonomy-rollback",
            title: "Taxonomy rollback",
            description: null,
            faviconUrl: null,
            contentPath: \`memories/\${memoryId}/CONTENT.md\`,
            extractionStatus: "success",
            extractionError: null,
            backupStatus: "disabled",
            lastBackupAt: null,
            lastBackupError: null,
            createdAt: now,
            updatedAt: now,
          });

          connection.sqlite.prepare(\`
            create trigger fail_memory_tags_insert
            before insert on memory_tags
            begin
              select raise(abort, 'memory_tags blocked');
            end
          \`).run();
          let tagError;
          try {
            await connection.repositories.taxonomy.createAndAttachTagToMemory({
              id: "tag-rolled-back",
              memoryId,
              name: "rolled back tag",
              now,
            });
          } catch (error) {
            tagError = error instanceof Error ? error.message : String(error);
          } finally {
            connection.sqlite.prepare("drop trigger fail_memory_tags_insert").run();
          }

          connection.sqlite.prepare(\`
            create trigger fail_memory_categories_insert
            before insert on memory_categories
            begin
              select raise(abort, 'memory_categories blocked');
            end
          \`).run();
          let categoryError;
          try {
            await connection.repositories.taxonomy.createAndAttachCategoryToMemory({
              id: "category-rolled-back",
              memoryId,
              name: "Rolled back category",
              now,
            });
          } catch (error) {
            categoryError = error instanceof Error ? error.message : String(error);
          } finally {
            connection.sqlite.prepare("drop trigger fail_memory_categories_insert").run();
          }

          process.stdout.write(JSON.stringify({
            tagError,
            tagCount: connection.sqlite
              .prepare("select count(*) as count from tags where name = ?")
              .get("rolled back tag"),
            categoryError,
            categoryCount: connection.sqlite
              .prepare("select count(*) as count from categories where name = ?")
              .get("Rolled back category"),
          }));
        } finally {
          connection.close();
        }
      `,
      { TRAUMA_TEST_ROOT: root },
    );

    expect(JSON.parse(output)).toEqual({
      tagError: "memory_tags blocked",
      tagCount: { count: 0 },
      categoryError: "memory_categories blocked",
      categoryCount: { count: 0 },
    });
  });

  it("creates, lists, and deletes Moments idempotently", () => {
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
            url: "https://example.com/moment",
            title: "Moment Memory",
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

          const created = await connection.repositories.moments.create({
            id: "moment-1",
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
          const duplicate = await connection.repositories.moments.create({
            id: "moment-duplicate",
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
          const movedAnchor = await connection.repositories.moments.create({
            id: "moment-moved",
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
          const listed = await connection.repositories.moments.listForBrowse();
          const deleted = await connection.repositories.moments.deleteById("moment-1");
          const missingDeleted = await connection.repositories.moments.deleteById("missing-moment");

          process.stdout.write(JSON.stringify({
            created,
            duplicate,
            movedAnchor,
            listed,
            deleted,
            missingDeleted,
            count: connection.sqlite.prepare("select count(*) as count from moments").get().count,
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
        moment: {
          id: "moment-1",
          sectionAnchor: "chapter-one",
          sectionTitle: "Chapter One",
        },
      },
      duplicate: {
        alreadyExists: true,
        moment: {
          id: "moment-1",
          sectionAnchor: "chapter-one",
        },
      },
      movedAnchor: {
        alreadyExists: true,
        moment: {
          id: "moment-1",
          sectionAnchor: "chapter-one-renamed",
          sectionTitle: "Chapter One Renamed",
          contentHash: "hash",
        },
      },
      listed: [
        {
          id: "moment-1",
          memoryTitle: "Moment Memory",
          memoryUrl: "https://example.com/moment",
          sectionAnchor: "chapter-one-renamed",
          sectionTitle: "Chapter One Renamed",
        },
      ],
      deleted: true,
      missingDeleted: false,
      count: 0,
    });
  });

  it("updates stale Moment anchor rows before treating them as existing", () => {
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
          const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f105";
          await connection.repositories.memories.create({
            id: memoryId,
            url: "https://example.com/stale-anchor",
            title: "Stale Anchor Memory",
            description: null,
            faviconUrl: null,
            contentPath: \`memories/\${memoryId}/CONTENT.md\`,
            extractionStatus: "success",
            extractionError: null,
            backupStatus: "disabled",
            lastBackupAt: null,
            lastBackupError: null,
            createdAt: now,
            updatedAt: now,
          });

          const stale = await connection.repositories.moments.create({
            id: "moment-stale-anchor",
            memoryId,
            sectionAnchor: "shared-title",
            sectionTitle: "Old Shared Title",
            sectionLevel: 2,
            sectionPath: "1/1",
            sectionStartOffset: null,
            sectionEndOffset: null,
            contentHash: "old-hash",
            createdAt: now,
            updatedAt: now,
          });
          const current = await connection.repositories.moments.create({
            id: "moment-current-anchor",
            memoryId,
            sectionAnchor: "shared-title",
            sectionTitle: "Current Shared Title",
            sectionLevel: 2,
            sectionPath: "2/1",
            sectionStartOffset: 10,
            sectionEndOffset: 25,
            contentHash: "current-hash",
            createdAt: later,
            updatedAt: later,
          });

          process.stdout.write(JSON.stringify({
            stale,
            current,
            rows: connection.sqlite.prepare("select id, section_anchor as sectionAnchor, section_title as sectionTitle, section_path as sectionPath, section_start_offset as sectionStartOffset, section_end_offset as sectionEndOffset, content_hash as contentHash from moments").all(),
          }));
        } finally {
          connection.close();
        }
      `,
      { TRAUMA_TEST_ROOT: root },
    );

    expect(JSON.parse(output)).toMatchObject({
      stale: {
        alreadyExists: false,
        moment: {
          id: "moment-stale-anchor",
          sectionAnchor: "shared-title",
          sectionPath: "1/1",
        },
      },
      current: {
        alreadyExists: true,
        moment: {
          id: "moment-stale-anchor",
          sectionAnchor: "shared-title",
          sectionTitle: "Current Shared Title",
          sectionPath: "2/1",
          sectionStartOffset: 10,
          sectionEndOffset: 25,
          contentHash: "current-hash",
        },
      },
      rows: [
        {
          id: "moment-stale-anchor",
          sectionAnchor: "shared-title",
          sectionTitle: "Current Shared Title",
          sectionPath: "2/1",
          contentHash: "current-hash",
        },
      ],
    });
  });

  it("resolves Moment anchor collisions before updating a stale section path", () => {
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
          const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f106";
          await connection.repositories.memories.create({
            id: memoryId,
            url: "https://example.com/path-anchor-collision",
            title: "Path Anchor Collision Memory",
            description: null,
            faviconUrl: null,
            contentPath: \`memories/\${memoryId}/CONTENT.md\`,
            extractionStatus: "success",
            extractionError: null,
            backupStatus: "disabled",
            lastBackupAt: null,
            lastBackupError: null,
            createdAt: now,
            updatedAt: now,
          });

          await connection.repositories.moments.create({
            id: "moment-path-owner",
            memoryId,
            sectionAnchor: "old-anchor",
            sectionTitle: "Old Anchor",
            sectionLevel: 2,
            sectionPath: "1/1",
            sectionStartOffset: 0,
            sectionEndOffset: 10,
            contentHash: "old-hash",
            createdAt: now,
            updatedAt: now,
          });
          await connection.repositories.moments.create({
            id: "moment-anchor-owner",
            memoryId,
            sectionAnchor: "new-anchor",
            sectionTitle: "New Anchor",
            sectionLevel: 2,
            sectionPath: "2/1",
            sectionStartOffset: 20,
            sectionEndOffset: 30,
            contentHash: "stale-hash",
            createdAt: now,
            updatedAt: now,
          });
          const updated = await connection.repositories.moments.create({
            id: "moment-request",
            memoryId,
            sectionAnchor: "new-anchor",
            sectionTitle: "New Anchor",
            sectionLevel: 2,
            sectionPath: "1/1",
            sectionStartOffset: 0,
            sectionEndOffset: 11,
            contentHash: "new-hash",
            createdAt: later,
            updatedAt: later,
          });

          process.stdout.write(JSON.stringify({
            updated,
            rows: connection.sqlite.prepare("select id, section_anchor as sectionAnchor, section_title as sectionTitle, section_path as sectionPath, section_start_offset as sectionStartOffset, section_end_offset as sectionEndOffset, content_hash as contentHash from moments order by id").all(),
          }));
        } finally {
          connection.close();
        }
      `,
      { TRAUMA_TEST_ROOT: root },
    );

    expect(JSON.parse(output)).toMatchObject({
      updated: {
        alreadyExists: true,
        moment: {
          id: "moment-path-owner",
          sectionAnchor: "new-anchor",
          sectionTitle: "New Anchor",
          sectionPath: "1/1",
          sectionStartOffset: 0,
          sectionEndOffset: 11,
          contentHash: "new-hash",
        },
      },
      rows: [
        {
          id: "moment-path-owner",
          sectionAnchor: "new-anchor",
          sectionTitle: "New Anchor",
          sectionPath: "1/1",
          sectionStartOffset: 0,
          sectionEndOffset: 11,
          contentHash: "new-hash",
        },
      ],
    });
  });

  it("uses insert-ignore semantics for duplicate Moment anchors", () => {
    expect(repositorySource).toContain(".onConflictDoNothing({");
    expect(repositorySource).toContain(
      "target: [schema.moments.memoryId, schema.moments.sectionAnchor]",
    );
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
          connection.sqlite.prepare("insert into flashbacks (id, memory_id, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run("flashback-delete", "018f04a2-3c6f-7c88-9a8b-8c99a9b7f103", "delete", "", "", 0, 6, now.getTime(), now.getTime());
          connection.sqlite.prepare("insert into moments (id, memory_id, section_anchor, section_title, section_level, section_path, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
            .run("moment-delete", "018f04a2-3c6f-7c88-9a8b-8c99a9b7f103", "chapter", "Chapter", 2, "1/1", now.getTime(), now.getTime());

          const target = await connection.repositories.memories.findDeletionTarget("018f04a2-3c6f-7c88-9a8b-8c99a9b7f103");
          const deleted = await connection.repositories.memories.deleteMemoryRecord("018f04a2-3c6f-7c88-9a8b-8c99a9b7f103");
          const missingDeleted = await connection.repositories.memories.deleteMemoryRecord("missing-memory");

          process.stdout.write(JSON.stringify({
            target,
            deleted,
            missingDeleted,
            memories: connection.sqlite.prepare("select count(*) as count from memories").get().count,
            flashbacks: connection.sqlite.prepare("select count(*) as count from flashbacks").get().count,
            moments: connection.sqlite.prepare("select count(*) as count from moments").get().count,
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
      moments: 0,
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

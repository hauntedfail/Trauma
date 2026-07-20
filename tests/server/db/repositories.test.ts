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

  it("resolves case-variant taxonomy names deterministically", () => {
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
          const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f104";
          await connection.repositories.memories.create({
            id: memoryId,
            url: "https://example.com/taxonomy-case",
            title: "Taxonomy case",
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

          connection.sqlite.prepare("insert into tags (id, name, created_at, updated_at) values (?, ?, ?, ?)").run("tag-lower", "harness", now.getTime(), now.getTime());
          connection.sqlite.prepare("insert into categories (id, name, created_at, updated_at) values (?, ?, ?, ?)").run("category-lower", "work", now.getTime(), now.getTime());

          const tag = await connection.repositories.taxonomy.createAndAttachTagToMemory({
            id: "tag-new",
            memoryId,
            name: "Harness",
            now,
          });
          const category = await connection.repositories.taxonomy.createAndAttachCategoryToMemory({
            id: "category-new",
            memoryId,
            name: "Work",
            now,
          });
          await connection.repositories.taxonomy.attachTagToMemory({
            memoryId,
            tagId: "tag-lower",
            now,
          });

          process.stdout.write(JSON.stringify({
            tag,
            category,
            memoryTags: connection.sqlite.prepare("select tag_id as tagId from memory_tags order by tag_id").all(),
            memoryCategories: connection.sqlite.prepare("select category_id as categoryId from memory_categories order by category_id").all(),
          }));
        } finally {
          connection.close();
        }
      `,
      { TRAUMA_TEST_ROOT: root },
    );

    expect(JSON.parse(output)).toMatchObject({
      tag: { id: "tag-lower", name: "harness" },
      category: { id: "category-lower", name: "work" },
      memoryTags: [{ tagId: "tag-lower" }],
      memoryCategories: [{ categoryId: "category-lower" }],
    });
  });

  it("serializes case-variant taxonomy creation across independent connections", () => {
    const root = createTempRoot(tempRoots);
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }
        const config = {
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
        const first = initializeDatabase(config);
        const second = initializeDatabase(config);
        try {
          const now = new Date("2026-07-17T00:00:00.000Z");
          const [tagUpper, tagLower, categoryUpper, categoryLower] =
            await Promise.all([
              first.repositories.taxonomy.createTag({
                id: "tag-race-upper",
                name: "Harness",
                now,
              }),
              second.repositories.taxonomy.createTag({
                id: "tag-race-lower",
                name: "harness",
                now,
              }),
              first.repositories.taxonomy.createCategory({
                id: "category-race-upper",
                name: "Research",
                now,
              }),
              second.repositories.taxonomy.createCategory({
                id: "category-race-lower",
                name: "research",
                now,
              }),
            ]);
          process.stdout.write(JSON.stringify({
            categoryIds: [categoryUpper.id, categoryLower.id],
            categoryRows: first.sqlite
              .prepare("select id, name from categories where lower(name) = 'research'")
              .all(),
            tagIds: [tagUpper.id, tagLower.id],
            tagRows: first.sqlite
              .prepare("select id, name from tags where lower(name) = 'harness'")
              .all(),
          }));
        } finally {
          first.close();
          second.close();
        }
      `,
      { TRAUMA_TEST_ROOT: root },
    );

    const result = JSON.parse(output);
    expect(new Set(result.tagIds).size).toBe(1);
    expect(result.tagRows).toHaveLength(1);
    expect(new Set(result.categoryIds).size).toBe(1);
    expect(result.categoryRows).toHaveLength(1);
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
              name: "rolled-back-tag",
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
          const listed = await connection.repositories.moments.listPageForBrowse({
            cursor: null,
            limit: 100,
          });
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

  it("keyset-paginates Flashbacks and Moments by created_at then id without gaps", () => {
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
              enabled: false,
              remote: "origin",
              branch: "main",
              push: false,
              commitMessageTemplate: "backup memory {memoryId}",
            },
          },
        });

        try {
          const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f199";
          const tied = new Date("2026-07-17T00:00:00.000Z");
          const older = new Date("2026-07-16T00:00:00.000Z");
          await connection.repositories.memories.create({
            id: memoryId,
            url: "https://example.com/keyset",
            title: "Keyset Memory",
            description: null,
            faviconUrl: null,
            contentPath: "memories/" + memoryId + "/CONTENT.md",
            extractionStatus: "success",
            extractionError: null,
            backupStatus: "disabled",
            lastBackupAt: null,
            lastBackupError: null,
            createdAt: older,
            updatedAt: older,
          });

          for (const [id, createdAt] of [
            ["flashback-a", tied],
            ["flashback-c", tied],
            ["flashback-b", tied],
            ["flashback-older", older],
          ]) {
            connection.sqlite.prepare(
              "insert into flashbacks (id, memory_id, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ).run(
              id,
              memoryId,
              id,
              "",
              "",
              0,
              id.length,
              createdAt.getTime(),
              createdAt.getTime(),
            );
          }
          for (const [id, createdAt] of [
            ["moment-a", tied],
            ["moment-c", tied],
            ["moment-b", tied],
            ["moment-older", older],
          ]) {
            connection.sqlite.prepare(
              "insert into moments (id, memory_id, section_anchor, section_title, section_level, section_path, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
            ).run(
              id,
              memoryId,
              id,
              id,
              2,
              id,
              createdAt.getTime(),
              createdAt.getTime(),
            );
          }

          const flashbackFirst = await connection.repositories.flashbacks.listRecentForBrowse({
            cursor: null,
            limit: 2,
          });
          const flashbackLast = flashbackFirst.at(-1);
          const flashbackSecond = await connection.repositories.flashbacks.listRecentForBrowse({
            cursor: flashbackLast === undefined
              ? null
              : { createdAt: new Date(flashbackLast.createdAt), id: flashbackLast.id },
            limit: 2,
          });
          const momentFirst = await connection.repositories.moments.listPageForBrowse({
            cursor: null,
            limit: 2,
          });
          const momentLast = momentFirst.at(-1);
          const momentSecond = await connection.repositories.moments.listPageForBrowse({
            cursor: momentLast === undefined
              ? null
              : { createdAt: new Date(momentLast.createdAt), id: momentLast.id },
            limit: 2,
          });

          process.stdout.write(JSON.stringify({
            flashbacks: [...flashbackFirst, ...flashbackSecond].map((row) => row.id),
            moments: [...momentFirst, ...momentSecond].map((row) => row.id),
          }));
        } finally {
          connection.close();
        }
      `,
      { TRAUMA_TEST_ROOT: root },
    );

    expect(JSON.parse(output)).toEqual({
      flashbacks: ["flashback-c", "flashback-b", "flashback-a", "flashback-older"],
      moments: ["moment-c", "moment-b", "moment-a", "moment-older"],
    });
  });

  it("serializes concurrent Moment path creates and crossed anchor moves", () => {
    const root = createTempRoot(tempRoots);
    const output = runBunScript(
      `
        import { join } from "node:path";
        import { initializeDatabase } from "./src/server/db/index.ts";

        const root = process.env.TRAUMA_TEST_ROOT;
        if (!root) {
          throw new Error("TRAUMA_TEST_ROOT is required");
        }

        const config = {
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
        const firstConnection = initializeDatabase(config);
        const secondConnection = initializeDatabase(config);

        try {
          const busyTimeouts = [firstConnection, secondConnection].map(
            (connection) => connection.sqlite.prepare("PRAGMA busy_timeout").get().timeout,
          );
          const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f107";
          const now = new Date("2026-05-10T01:00:00.000Z");
          const later = new Date("2026-05-10T02:00:00.000Z");
          await firstConnection.repositories.memories.create({
            id: memoryId,
            url: "https://example.com/concurrent-moment",
            title: "Concurrent Moment Memory",
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

          const [first, second] = await Promise.all([
            firstConnection.repositories.moments.create({
              id: "moment-concurrent-first",
              memoryId,
              sectionAnchor: "first-anchor",
              sectionTitle: "First title",
              sectionLevel: 2,
              sectionPath: "1/1",
              sectionStartOffset: 0,
              sectionEndOffset: 10,
              contentHash: "first-hash",
              createdAt: now,
              updatedAt: now,
            }),
            secondConnection.repositories.moments.create({
              id: "moment-concurrent-second",
              memoryId,
              sectionAnchor: "second-anchor",
              sectionTitle: "Second title",
              sectionLevel: 2,
              sectionPath: "1/1",
              sectionStartOffset: 0,
              sectionEndOffset: 12,
              contentHash: "second-hash",
              createdAt: later,
              updatedAt: later,
            }),
          ]);

          const crossedMemoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f108";
          await firstConnection.repositories.memories.create({
            id: crossedMemoryId,
            url: "https://example.com/crossed-moment",
            title: "Crossed Moment Memory",
            description: null,
            faviconUrl: null,
            contentPath: \`memories/\${crossedMemoryId}/CONTENT.md\`,
            extractionStatus: "success",
            extractionError: null,
            backupStatus: "disabled",
            lastBackupAt: null,
            lastBackupError: null,
            createdAt: now,
            updatedAt: now,
          });
          await firstConnection.repositories.moments.create({
            id: "moment-cross-owner-one",
            memoryId: crossedMemoryId,
            sectionAnchor: "cross-anchor-one",
            sectionTitle: "Cross one",
            sectionLevel: 2,
            sectionPath: "1/1",
            sectionStartOffset: 0,
            sectionEndOffset: 10,
            contentHash: "cross-one-hash",
            createdAt: now,
            updatedAt: now,
          });
          await firstConnection.repositories.moments.create({
            id: "moment-cross-owner-two",
            memoryId: crossedMemoryId,
            sectionAnchor: "cross-anchor-two",
            sectionTitle: "Cross two",
            sectionLevel: 2,
            sectionPath: "2/1",
            sectionStartOffset: 20,
            sectionEndOffset: 30,
            contentHash: "cross-two-hash",
            createdAt: now,
            updatedAt: now,
          });
          const [crossedFirst, crossedSecond] = await Promise.all([
            firstConnection.repositories.moments.create({
              id: "moment-cross-request-one",
              memoryId: crossedMemoryId,
              sectionAnchor: "cross-anchor-two",
              sectionTitle: "Cross one current",
              sectionLevel: 2,
              sectionPath: "1/1",
              sectionStartOffset: 0,
              sectionEndOffset: 12,
              contentHash: "cross-one-current-hash",
              createdAt: later,
              updatedAt: later,
            }),
            secondConnection.repositories.moments.create({
              id: "moment-cross-request-two",
              memoryId: crossedMemoryId,
              sectionAnchor: "cross-anchor-one",
              sectionTitle: "Cross two current",
              sectionLevel: 2,
              sectionPath: "2/1",
              sectionStartOffset: 20,
              sectionEndOffset: 32,
              contentHash: "cross-two-current-hash",
              createdAt: later,
              updatedAt: later,
            }),
          ]);

          process.stdout.write(JSON.stringify({
            busyTimeouts,
            first,
            second,
            rows: firstConnection.sqlite
              .prepare("select id, section_anchor as sectionAnchor, section_title as sectionTitle, section_path as sectionPath, content_hash as contentHash from moments")
              .all()
              .filter((row) => row.id.startsWith("moment-concurrent")),
            crossedFirst,
            crossedSecond,
            crossedRows: firstConnection.sqlite
              .prepare("select id, section_anchor as sectionAnchor, section_title as sectionTitle, section_path as sectionPath, content_hash as contentHash from moments where memory_id = ? order by section_path")
              .all(crossedMemoryId),
          }));
        } finally {
          secondConnection.close();
          firstConnection.close();
        }
      `,
      { TRAUMA_TEST_ROOT: root },
    );

    expect(JSON.parse(output)).toMatchObject({
      busyTimeouts: [5000, 5000],
      first: {
        alreadyExists: false,
        moment: {
          id: "moment-concurrent-first",
          sectionAnchor: "first-anchor",
        },
      },
      second: {
        alreadyExists: true,
        moment: {
          id: "moment-concurrent-first",
          sectionAnchor: "second-anchor",
          sectionTitle: "Second title",
          sectionPath: "1/1",
          contentHash: "second-hash",
        },
      },
      rows: [
        {
          id: "moment-concurrent-first",
          sectionAnchor: "second-anchor",
          sectionTitle: "Second title",
          sectionPath: "1/1",
          contentHash: "second-hash",
        },
      ],
      crossedFirst: {
        alreadyExists: true,
        moment: {
          id: "moment-cross-owner-one",
          sectionAnchor: "cross-anchor-two",
          sectionPath: "1/1",
        },
      },
      crossedSecond: {
        alreadyExists: false,
        moment: {
          id: "moment-cross-request-two",
          sectionAnchor: "cross-anchor-one",
          sectionPath: "2/1",
        },
      },
      crossedRows: [
        {
          id: "moment-cross-owner-one",
          sectionAnchor: "cross-anchor-two",
          sectionTitle: "Cross one current",
          sectionPath: "1/1",
          contentHash: "cross-one-current-hash",
        },
        {
          id: "moment-cross-request-two",
          sectionAnchor: "cross-anchor-one",
          sectionTitle: "Cross two current",
          sectionPath: "2/1",
          contentHash: "cross-two-current-hash",
        },
      ],
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

  it("uses the Moment path identity inside an immediate transaction", () => {
    expect(repositorySource).toContain(".onConflictDoNothing({");
    expect(repositorySource).toContain(
      "target: [schema.moments.memoryId, schema.moments.sectionPath]",
    );
    expect(repositorySource).toContain('{ behavior: "immediate" }');
  });

  it("keeps reader aggregates scoped to metadata and active-variant relations", () => {
    const aggregateStart = repositorySource.indexOf(
      "findReaderAggregateById: async",
    );
    const aggregateEnd = repositorySource.indexOf(
      "create: async (input)",
      aggregateStart,
    );
    expect(aggregateStart).toBeGreaterThanOrEqual(0);
    expect(aggregateEnd).toBeGreaterThan(aggregateStart);

    const aggregateSource = repositorySource.slice(aggregateStart, aggregateEnd);
    expect(aggregateSource).toContain("columns: {");
    expect(aggregateSource).toContain("moments: {");
    expect(aggregateSource).toContain("memoryCategories: {");
    expect(aggregateSource).toContain("memoryTags: {");
    expect(aggregateSource).not.toContain("flashbacks:");
    expect(aggregateSource).not.toContain("backupStatus:");
    expect(aggregateSource).not.toContain("extractionError:");
  });

  it("paginates memory browse rows with server-side filters and escaped search", () => {
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

        const baseInput = {
          categoryId: "",
          cursor: null,
          flashbackId: "",
          limit: 10,
          readState: "all",
          searchFields: [],
          searchTerms: [],
          tagId: "",
        };

        async function createMemory(input) {
          await connection.repositories.memories.create({
            id: input.id,
            url: input.url,
            title: input.title,
            description: input.description,
            faviconUrl: null,
            contentPath: "memories/" + input.id + "/CONTENT.md",
            extractionStatus: "success",
            extractionError: null,
            read: input.read,
            backupStatus: "disabled",
            lastBackupAt: null,
            lastBackupError: null,
            createdAt: input.createdAt,
            updatedAt: input.createdAt,
          });
        }

        function insertTaxonomy() {
          const now = Date.parse("2026-05-20T00:00:00.000Z");
          connection.sqlite.prepare("insert into categories (id, name, created_at, updated_at) values (?, ?, ?, ?)").run("category-research", "Research", now, now);
          connection.sqlite.prepare("insert into categories (id, name, created_at, updated_at) values (?, ?, ?, ?)").run("category-ops", "Operations", now, now);
          connection.sqlite.prepare("insert into tags (id, name, created_at, updated_at) values (?, ?, ?, ?)").run("tag-lazy", "lazy", now, now);
          connection.sqlite.prepare("insert into tags (id, name, created_at, updated_at) values (?, ?, ?, ?)").run("tag-search", "search", now, now);
          connection.sqlite.prepare("insert into tags (id, name, created_at, updated_at) values (?, ?, ?, ?)").run("tag-sqlite", "sqlite", now, now);
          connection.sqlite.prepare("insert into memory_categories (memory_id, category_id, created_at, updated_at) values (?, ?, ?, ?)").run("memory-a", "category-research", now, now);
          connection.sqlite.prepare("insert into memory_categories (memory_id, category_id, created_at, updated_at) values (?, ?, ?, ?)").run("memory-b", "category-ops", now, now);
          connection.sqlite.prepare("insert into memory_tags (memory_id, tag_id, created_at, updated_at) values (?, ?, ?, ?)").run("memory-a", "tag-lazy", now, now);
          connection.sqlite.prepare("insert into memory_tags (memory_id, tag_id, created_at, updated_at) values (?, ?, ?, ?)").run("memory-a", "tag-search", now, now);
          connection.sqlite.prepare("insert into memory_tags (memory_id, tag_id, created_at, updated_at) values (?, ?, ?, ?)").run("memory-b", "tag-sqlite", now, now);
          connection.sqlite.prepare("insert into memory_tags (memory_id, tag_id, created_at, updated_at) values (?, ?, ?, ?)").run("memory-e", "tag-lazy", now, now);
        }

        function insertFlashbacks() {
          const now = Date.parse("2026-05-20T00:00:00.000Z");
          connection.sqlite
            .prepare("insert into flashbacks (id, memory_id, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run("flashback-a", "memory-a", "outside initial flashback literal 100%_match", "needle prefix", "context", 0, 43, now, now);
          connection.sqlite
            .prepare("insert into flashbacks (id, memory_id, text, prefix, suffix, start_offset, end_offset, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run("flashback-selected", "memory-c", "selected excerpt", "cursor", "target", 0, 16, now, now);
        }

        async function page(overrides) {
          return connection.repositories.memories.listForBrowsePage({
            ...baseInput,
            ...overrides,
          });
        }

        try {
          await createMemory({
            id: "memory-a",
            title: "Literal 100%_match Memory",
            url: "https://example.com/a",
            description: "Old research item",
            read: false,
            createdAt: new Date("2026-05-17T00:00:00.000Z"),
          });
          await createMemory({
            id: "memory-b",
            title: "SQLite Read Item",
            url: "https://example.com/b",
            description: "Read database item",
            read: true,
            createdAt: new Date("2026-05-18T00:00:00.000Z"),
          });
          await createMemory({
            id: "memory-c",
            title: "Cursor Peer C",
            url: "https://example.com/c",
            description: "Peer item",
            read: false,
            createdAt: new Date("2026-05-19T00:00:00.000Z"),
          });
          await createMemory({
            id: "memory-d",
            title: "Cursor Peer D",
            url: "https://example.com/d",
            description: "Back\\\\slash exact",
            read: false,
            createdAt: new Date("2026-05-19T00:00:00.000Z"),
          });
          await createMemory({
            id: "memory-e",
            title: "Literal 100AAAmatch Decoy",
            url: "https://example.com/e",
            description: "Latest item",
            read: false,
            createdAt: new Date("2026-05-20T00:00:00.000Z"),
          });
          insertTaxonomy();
          insertFlashbacks();

          const firstPage = await page({ limit: 2 });
          const secondPage = await page({ limit: 2, cursor: firstPage.nextCursor });
          const readPage = await page({ readState: "read" });
          const unreadPage = await page({ readState: "unread" });
          const allPage = await page({ readState: "all" });
          const conflictingReadStatePage = await page({ readState: "both" });

          process.stdout.write(JSON.stringify({
            firstPageIds: firstPage.rows.map((memory) => memory.id),
            firstPageHasFlashbacks: Object.prototype.hasOwnProperty.call(firstPage.rows[0] ?? {}, "flashbacks"),
            firstPageNextCursor: firstPage.nextCursor,
            secondPageIds: secondPage.rows.map((memory) => memory.id),
            readIds: readPage.rows.map((memory) => memory.id),
            unreadIds: unreadPage.rows.map((memory) => memory.id),
            allIds: allPage.rows.map((memory) => memory.id),
            conflictingReadStateIds: conflictingReadStatePage.rows.map((memory) => memory.id),
            categoryIds: (await page({ categoryId: "category-research" })).rows.map((memory) => memory.id),
            tagIds: (await page({ tagId: "tag-sqlite" })).rows.map((memory) => memory.id),
            flashbackIds: (await page({ flashbackId: "flashback-selected" })).rows.map((memory) => memory.id),
            freeCategoryIds: (await page({ searchTerms: ["research"] })).rows.map((memory) => memory.id),
            freeTagIds: (await page({ searchTerms: ["lazy"] })).rows.map((memory) => memory.id),
            freeFlashbackIds: (await page({ searchTerms: ["outside"] })).rows.map((memory) => memory.id),
            escapedPercentIds: (await page({ searchTerms: ["100%_match"] })).rows.map((memory) => memory.id),
            escapedBackslashIds: (await page({ searchTerms: ["back\\\\slash"] })).rows.map((memory) => memory.id),
            fieldedTagIds: (await page({ searchFields: [{ field: "tag", values: ["sqlite"] }] })).rows.map((memory) => memory.id),
            fieldedCategoryIds: (await page({ searchFields: [{ field: "category", values: ["Research"] }] })).rows.map((memory) => memory.id),
            fieldedFlashbackIds: (await page({ searchFields: [{ field: "flashback", values: ["needle prefix"] }] })).rows.map((memory) => memory.id),
            multiValueFieldIds: (await page({ searchFields: [{ field: "tag", values: ["lazy", "search"] }] })).rows.map((memory) => memory.id),
          }));
        } finally {
          connection.close();
        }
      `,
      { TRAUMA_TEST_ROOT: root },
    );

    expect(JSON.parse(output)).toEqual({
      firstPageIds: ["memory-e", "memory-d"],
      firstPageHasFlashbacks: false,
      firstPageNextCursor: {
        createdAt: "2026-05-19T00:00:00.000Z",
        id: "memory-d",
      },
      secondPageIds: ["memory-c", "memory-b"],
      readIds: ["memory-b"],
      unreadIds: ["memory-e", "memory-d", "memory-c", "memory-a"],
      allIds: ["memory-e", "memory-d", "memory-c", "memory-b", "memory-a"],
      conflictingReadStateIds: [],
      categoryIds: ["memory-a"],
      tagIds: ["memory-b"],
      flashbackIds: ["memory-c"],
      freeCategoryIds: ["memory-a"],
      freeTagIds: ["memory-e", "memory-a"],
      freeFlashbackIds: ["memory-a"],
      escapedPercentIds: ["memory-a"],
      escapedBackslashIds: ["memory-d"],
      fieldedTagIds: ["memory-b"],
      fieldedCategoryIds: ["memory-a"],
      fieldedFlashbackIds: ["memory-a"],
      multiValueFieldIds: ["memory-a"],
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

import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import type { ExtractionStatus } from "../memory-status";
import * as schema from "./schema";

export type TraumaDatabase = BunSQLiteDatabase<typeof schema>;
type Memory = typeof schema.memories.$inferSelect;
type NewMemory = typeof schema.memories.$inferInsert;
type Tag = typeof schema.tags.$inferSelect;
type Category = typeof schema.categories.$inferSelect;
type Highlight = typeof schema.highlights.$inferSelect;
export type BackupEnvironmentStamp =
  typeof schema.backupEnvironmentStamps.$inferSelect;
export type BackupFailsafeAlert =
  typeof schema.backupFailsafeAlerts.$inferSelect;
type MemoryBackupStatusUpdate = Pick<
  Memory,
  "id" | "backupStatus" | "lastBackupAt" | "lastBackupError" | "updatedAt"
>;
type MemoryBackupRetryRow = Pick<
  Memory,
  "id" | "contentPath" | "backupStatus" | "updatedAt"
>;

export interface MemoryBrowseRow {
  id: string;
  title: string;
  url: string;
  description: string;
  capturedAt: string;
  read: boolean;
  extractionStatus: ExtractionStatus;
  categories: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  highlights: { id: string; text: string; prefix: string; suffix: string; createdAt: string }[];
}

export interface HighlightBrowseRow {
  id: string;
  memoryId: string;
  memoryTitle: string;
  text: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
  createdAt: string;
}

export interface MemoryRepository {
  findById: (id: string) => Promise<Memory | undefined>;
  create: (input: NewMemory) => Promise<Memory>;
  setReadStatus: (input: {
    memoryId: string;
    read: boolean;
    updatedAt: Date;
  }) => Promise<Memory | undefined>;
  findDeletionTarget: (
    memoryId: string,
  ) => Promise<{ id: string; contentPath: string } | undefined>;
  deleteMemoryRecord: (memoryId: string) => Promise<boolean>;
  updateBackupStatus: (input: {
    id: string;
    backupStatus: schema.BackupStatus;
    lastBackupAt?: Date | null;
    lastBackupError?: string | null;
    updatedAt: Date;
  }) => Promise<MemoryBackupStatusUpdate>;
  listBackupsEligibleForRetry: () => Promise<MemoryBackupRetryRow[]>;
  listForBrowse: () => Promise<MemoryBrowseRow[]>;
}

export interface TaxonomyBrowseRow {
  id: string;
  name: string;
  memoryCount: number;
  lastAssignedAt: string | null;
}

export interface TaxonomyRepository {
  createTag: (input: { id: string; name: string; now: Date }) => Promise<Tag>;
  createCategory: (input: {
    id: string;
    name: string;
    now: Date;
  }) => Promise<Category>;
  findTagByName: (name: string) => Promise<Tag | undefined>;
  findCategoryByName: (name: string) => Promise<Category | undefined>;
  attachTagToMemory: (input: {
    memoryId: string;
    tagId: string;
    now: Date;
  }) => Promise<void>;
  attachCategoryToMemory: (input: {
    memoryId: string;
    categoryId: string;
    now: Date;
  }) => Promise<void>;
  listTagsForBrowse: () => Promise<TaxonomyBrowseRow[]>;
  listCategoriesForBrowse: () => Promise<TaxonomyBrowseRow[]>;
}

export interface HighlightRepository {
  listForMemory: (memoryId: string) => Promise<Highlight[]>;
  replaceForMemory: (memoryId: string, highlights: Highlight[]) => Promise<Highlight[]>;
  listForBrowse: () => Promise<HighlightBrowseRow[]>;
}

export interface BackupEnvironmentRepository {
  getBackupEnvironmentStamp: () => Promise<BackupEnvironmentStamp | undefined>;
  upsertBackupEnvironmentStamp: (
    input: BackupEnvironmentStamp,
  ) => Promise<BackupEnvironmentStamp>;
  getBackupFailsafeAlert: () => Promise<BackupFailsafeAlert | undefined>;
  upsertBackupFailsafeAlert: (
    input: BackupFailsafeAlert,
  ) => Promise<BackupFailsafeAlert>;
  clearBackupFailsafeAlert: () => Promise<void>;
}

export interface TraumaRepositories {
  backupEnvironment: BackupEnvironmentRepository;
  memories: MemoryRepository;
  highlights: HighlightRepository;
  taxonomy: TaxonomyRepository;
}

export class MemoryRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryRepositoryError";
  }
}

export function createRepositories(db: TraumaDatabase): TraumaRepositories {
  return {
    backupEnvironment: {
      getBackupEnvironmentStamp: async () =>
        db.query.backupEnvironmentStamps.findFirst({
          where: eq(schema.backupEnvironmentStamps.id, "default"),
        }),
      upsertBackupEnvironmentStamp: async (input) => {
        await db
          .insert(schema.backupEnvironmentStamps)
          .values(input)
          .onConflictDoUpdate({
            target: schema.backupEnvironmentStamps.id,
            set: {
              projectPath: input.projectPath,
              storePath: input.storePath,
              gitRemote: input.gitRemote,
              gitRemoteUrl: input.gitRemoteUrl,
              gitBranch: input.gitBranch,
              updatedAt: input.updatedAt,
            },
          })
          .run();
        return input;
      },
      getBackupFailsafeAlert: async () =>
        db.query.backupFailsafeAlerts.findFirst({
          where: eq(schema.backupFailsafeAlerts.id, "active"),
        }),
      upsertBackupFailsafeAlert: async (input) => {
        await db
          .insert(schema.backupFailsafeAlerts)
          .values(input)
          .onConflictDoUpdate({
            target: schema.backupFailsafeAlerts.id,
            set: {
              kind: input.kind,
              severity: input.severity,
              message: input.message,
              previousProjectPath: input.previousProjectPath,
              previousStorePath: input.previousStorePath,
              currentProjectPath: input.currentProjectPath,
              currentStorePath: input.currentStorePath,
              gitRemote: input.gitRemote,
              gitRemoteUrl: input.gitRemoteUrl,
              gitBranch: input.gitBranch,
              error: input.error,
              updatedAt: input.updatedAt,
            },
          })
          .run();
        return input;
      },
      clearBackupFailsafeAlert: async () => {
        await db
          .delete(schema.backupFailsafeAlerts)
          .where(eq(schema.backupFailsafeAlerts.id, "active"))
          .run();
      },
    },
    highlights: {
      listForMemory: async (memoryId) =>
        db.query.highlights.findMany({
          where: eq(schema.highlights.memoryId, memoryId),
          orderBy: [asc(schema.highlights.startOffset)],
        }),
      replaceForMemory: async (memoryId, highlightRows) => {
        const mismatchedRow = highlightRows.find(
          (highlight) => highlight.memoryId !== memoryId,
        );
        if (mismatchedRow !== undefined) {
          throw new MemoryRepositoryError(
            "Cannot replace highlights for one memory with rows from another memory.",
          );
        }

        await db.transaction(async (tx) => {
          await tx
            .delete(schema.highlights)
            .where(eq(schema.highlights.memoryId, memoryId))
            .run();

          if (highlightRows.length > 0) {
            await tx.insert(schema.highlights).values(highlightRows).run();
          }
        });

        return highlightRows;
      },
      listForBrowse: async () => {
        const rows = await db
          .select({
            id: schema.highlights.id,
            memoryId: schema.highlights.memoryId,
            memoryTitle: schema.memories.title,
            text: schema.highlights.text,
            prefix: schema.highlights.prefix,
            suffix: schema.highlights.suffix,
            startOffset: schema.highlights.startOffset,
            endOffset: schema.highlights.endOffset,
            createdAt: schema.highlights.createdAt,
          })
          .from(schema.highlights)
          .innerJoin(
            schema.memories,
            eq(schema.highlights.memoryId, schema.memories.id),
          )
          .orderBy(desc(schema.highlights.createdAt));

        return rows.map((row) => ({
          ...row,
          createdAt: formatDateTime(row.createdAt),
        }));
      },
    },
    memories: {
      findById: async (id) =>
        db.query.memories.findFirst({
          where: eq(schema.memories.id, id),
        }),
      create: async (input) => {
        await db.insert(schema.memories).values(input).run();
        return {
          id: input.id,
          url: input.url,
          title: input.title,
          description: input.description ?? null,
          faviconUrl: input.faviconUrl ?? null,
          contentPath: input.contentPath,
          extractionStatus: input.extractionStatus,
          extractionError: input.extractionError ?? null,
          read: input.read ?? false,
          backupStatus: input.backupStatus,
          lastBackupAt: input.lastBackupAt ?? null,
          lastBackupError: input.lastBackupError ?? null,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        };
      },
      setReadStatus: async (input) =>
        db
          .update(schema.memories)
          .set({
            read: input.read,
            updatedAt: input.updatedAt,
          })
          .where(eq(schema.memories.id, input.memoryId))
          .returning()
          .get(),
      findDeletionTarget: async (memoryId) =>
        db.query.memories.findFirst({
          columns: {
            id: true,
            contentPath: true,
          },
          where: eq(schema.memories.id, memoryId),
        }),
      deleteMemoryRecord: async (memoryId) => {
        const deleted = await db
          .delete(schema.memories)
          .where(eq(schema.memories.id, memoryId))
          .returning({ id: schema.memories.id })
          .get();
        return deleted !== undefined;
      },
      updateBackupStatus: async (input) => {
        const values: {
          backupStatus: schema.BackupStatus;
          lastBackupAt?: Date | null;
          lastBackupError?: string | null;
          updatedAt: Date;
        } = {
          backupStatus: input.backupStatus,
          updatedAt: input.updatedAt,
        };
        if ("lastBackupAt" in input) {
          values.lastBackupAt = input.lastBackupAt;
        }
        if ("lastBackupError" in input) {
          values.lastBackupError = input.lastBackupError;
        }

        const updated = await db
          .update(schema.memories)
          .set(values)
          .where(eq(schema.memories.id, input.id))
          .returning({
            id: schema.memories.id,
            backupStatus: schema.memories.backupStatus,
            lastBackupAt: schema.memories.lastBackupAt,
            lastBackupError: schema.memories.lastBackupError,
            updatedAt: schema.memories.updatedAt,
          })
          .get();
        if (updated === undefined) {
          throw new MemoryRepositoryError(
            `Cannot update backup status for missing memory: ${input.id}`,
          );
        }
        return updated;
      },
      listBackupsEligibleForRetry: async () =>
        db.query.memories.findMany({
          columns: {
            id: true,
            contentPath: true,
            backupStatus: true,
            updatedAt: true,
          },
          where: inArray(schema.memories.backupStatus, ["pending", "queued", "failed"]),
          orderBy: [asc(schema.memories.updatedAt), asc(schema.memories.id)],
        }),
      listForBrowse: async () => {
        const rows = await db.query.memories.findMany({
          orderBy: [desc(schema.memories.createdAt)],
          with: {
            highlights: {
              orderBy: [desc(schema.highlights.createdAt)],
            },
            memoryCategories: {
              with: {
                category: true,
              },
            },
            memoryTags: {
              with: {
                tag: true,
              },
            },
          },
        });

        return rows.map((memory) => ({
          id: memory.id,
          title: memory.title,
          url: memory.url,
          description: memory.description ?? "",
          capturedAt: formatDate(memory.createdAt),
          read: memory.read,
          extractionStatus: memory.extractionStatus,
          categories: memory.memoryCategories.map(({ category }) => ({
            id: category.id,
            name: category.name,
          })),
          tags: memory.memoryTags.map(({ tag }) => ({
            id: tag.id,
            name: tag.name,
          })),
          highlights: memory.highlights.map((highlight) => ({
            id: highlight.id,
            text: highlight.text,
            prefix: highlight.prefix,
            suffix: highlight.suffix,
            createdAt: formatDateTime(highlight.createdAt),
          })),
        }));
      },
    },
    taxonomy: {
      createTag: async (input) => {
        await db
          .insert(schema.tags)
          .values({
            id: input.id,
            name: input.name,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoNothing({ target: schema.tags.name })
          .run();
        return requireTagByName(db, input.name);
      },
      createCategory: async (input) => {
        await db
          .insert(schema.categories)
          .values({
            id: input.id,
            name: input.name,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoNothing({ target: schema.categories.name })
          .run();
        return requireCategoryByName(db, input.name);
      },
      findTagByName: async (name) =>
        db.query.tags.findFirst({
          where: eq(schema.tags.name, name),
        }),
      findCategoryByName: async (name) =>
        db.query.categories.findFirst({
          where: eq(schema.categories.name, name),
        }),
      attachTagToMemory: async (input) => {
        await assertMemoryExists(db, input.memoryId, "attach tag to");
        await assertTagExists(db, input.tagId);
        await db
          .insert(schema.memoryTags)
          .values({
            memoryId: input.memoryId,
            tagId: input.tagId,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoUpdate({
            target: [schema.memoryTags.memoryId, schema.memoryTags.tagId],
            set: {
              updatedAt: input.now,
            },
          })
          .run();
      },
      attachCategoryToMemory: async (input) => {
        await assertMemoryExists(db, input.memoryId, "attach category to");
        await assertCategoryExists(db, input.categoryId);
        await db
          .insert(schema.memoryCategories)
          .values({
            memoryId: input.memoryId,
            categoryId: input.categoryId,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoUpdate({
            target: [
              schema.memoryCategories.memoryId,
              schema.memoryCategories.categoryId,
            ],
            set: {
              updatedAt: input.now,
            },
          })
          .run();
      },
      listTagsForBrowse: async () => listTagsForBrowse(db),
      listCategoriesForBrowse: async () => listCategoriesForBrowse(db),
    },
  };
}

async function requireTagByName(db: TraumaDatabase, name: string): Promise<Tag> {
  const tag = await db.query.tags.findFirst({
    where: eq(schema.tags.name, name),
  });
  if (tag === undefined) {
    throw new MemoryRepositoryError(`Cannot find tag after create: ${name}`);
  }
  return tag;
}

async function requireCategoryByName(
  db: TraumaDatabase,
  name: string,
): Promise<Category> {
  const category = await db.query.categories.findFirst({
    where: eq(schema.categories.name, name),
  });
  if (category === undefined) {
    throw new MemoryRepositoryError(`Cannot find category after create: ${name}`);
  }
  return category;
}

async function assertMemoryExists(
  db: TraumaDatabase,
  memoryId: string,
  action: "attach tag to" | "attach category to",
): Promise<void> {
  const memory = await db.query.memories.findFirst({
    columns: {
      id: true,
    },
    where: eq(schema.memories.id, memoryId),
  });
  if (memory === undefined) {
    throw new MemoryRepositoryError(`Cannot ${action} missing memory: ${memoryId}`);
  }
}

async function assertTagExists(db: TraumaDatabase, tagId: string): Promise<void> {
  const tag = await db.query.tags.findFirst({
    columns: {
      id: true,
    },
    where: eq(schema.tags.id, tagId),
  });
  if (tag === undefined) {
    throw new MemoryRepositoryError(`Cannot attach missing tag: ${tagId}`);
  }
}

async function assertCategoryExists(
  db: TraumaDatabase,
  categoryId: string,
): Promise<void> {
  const category = await db.query.categories.findFirst({
    columns: {
      id: true,
    },
    where: eq(schema.categories.id, categoryId),
  });
  if (category === undefined) {
    throw new MemoryRepositoryError(`Cannot attach missing category: ${categoryId}`);
  }
}

async function listTagsForBrowse(db: TraumaDatabase): Promise<TaxonomyBrowseRow[]> {
  const rows = await db
    .select({
      id: schema.tags.id,
      name: schema.tags.name,
      memoryCount: sql<number>`count(${schema.memoryTags.memoryId})`,
      lastAssignedAt: sql<Date | number | null>`max(${schema.memoryTags.updatedAt})`,
    })
    .from(schema.tags)
    .leftJoin(schema.memoryTags, eq(schema.tags.id, schema.memoryTags.tagId))
    .groupBy(schema.tags.id, schema.tags.name)
    .orderBy(
      desc(sql`count(${schema.memoryTags.memoryId})`),
      desc(sql`max(${schema.memoryTags.updatedAt})`),
      asc(schema.tags.name),
    );

  return rows.map(formatTaxonomyBrowseRow);
}

async function listCategoriesForBrowse(
  db: TraumaDatabase,
): Promise<TaxonomyBrowseRow[]> {
  const rows = await db
    .select({
      id: schema.categories.id,
      name: schema.categories.name,
      memoryCount: sql<number>`count(${schema.memoryCategories.memoryId})`,
      lastAssignedAt: sql<Date | number | null>`max(${schema.memoryCategories.updatedAt})`,
    })
    .from(schema.categories)
    .leftJoin(
      schema.memoryCategories,
      eq(schema.categories.id, schema.memoryCategories.categoryId),
    )
    .groupBy(schema.categories.id, schema.categories.name)
    .orderBy(
      desc(sql`count(${schema.memoryCategories.memoryId})`),
      desc(sql`max(${schema.memoryCategories.updatedAt})`),
      asc(schema.categories.name),
    );

  return rows.map(formatTaxonomyBrowseRow);
}

function formatTaxonomyBrowseRow(row: {
  id: string;
  name: string;
  memoryCount: number;
  lastAssignedAt: Date | number | null;
}): TaxonomyBrowseRow {
  return {
    id: row.id,
    name: row.name,
    memoryCount: row.memoryCount,
    lastAssignedAt:
      row.lastAssignedAt === null ? null : formatDateTime(row.lastAssignedAt),
  };
}

function formatDate(value: Date | number) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

function formatDateTime(value: Date | number) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

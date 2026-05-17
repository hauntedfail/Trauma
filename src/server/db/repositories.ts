import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import type { ExtractionStatus } from "../memory-status";
import {
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  type SupportedLanguageCode,
} from "../../settings/languages";
import * as schema from "./schema";

export type TraumaDatabase = BunSQLiteDatabase<typeof schema>;
type Memory = typeof schema.memories.$inferSelect;
type NewMemory = typeof schema.memories.$inferInsert;
type Tag = typeof schema.tags.$inferSelect;
type Category = typeof schema.categories.$inferSelect;
type Moment = typeof schema.moments.$inferSelect;
type NewMoment = typeof schema.moments.$inferInsert;
type Flashback = typeof schema.flashbacks.$inferSelect;
type AppSettings = typeof schema.appSettings.$inferSelect;
type OpenAiAuthCredential = typeof schema.openaiAuthCredentials.$inferSelect;
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
export type ReaderMemoryAggregateRow = Memory & {
  moments: Moment[];
  flashbacks: Flashback[];
  memoryCategories: { category: Category }[];
  memoryTags: { tag: Tag }[];
};

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
  flashbacks: FlashbackBrowseRow[];
}

export interface FlashbackBrowseRow {
  id: string;
  memoryId: string;
  memoryTitle: string;
  text: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
  contentHash?: string | null;
  createdAt: string;
}

export interface MomentBrowseRow {
  id: string;
  memoryId: string;
  memoryTitle: string;
  memoryUrl: string;
  sectionAnchor: string;
  sectionTitle: string;
  sectionLevel: number;
  sectionPath: string;
  sectionStartOffset: number | null;
  sectionEndOffset: number | null;
  contentHash: string | null;
  createdAt: string;
}

export interface MemoryRepository {
  findById: (id: string) => Promise<Memory | undefined>;
  findReaderAggregateById: (
    id: string,
  ) => Promise<ReaderMemoryAggregateRow | undefined>;
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
  createAndAttachTagToMemory: (input: {
    id: string;
    memoryId: string;
    name: string;
    now: Date;
  }) => Promise<Tag>;
  createCategory: (input: {
    id: string;
    name: string;
    now: Date;
  }) => Promise<Category>;
  createAndAttachCategoryToMemory: (input: {
    id: string;
    memoryId: string;
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

export interface FlashbackRepository {
  listForMemory: (memoryId: string) => Promise<Flashback[]>;
  replaceForMemory: (memoryId: string, flashbacks: Flashback[]) => Promise<Flashback[]>;
  listForBrowse: () => Promise<FlashbackBrowseRow[]>;
}

export interface MomentRepository {
  create: (
    input: NewMoment,
  ) => Promise<{ moment: Moment; alreadyExists: boolean }>;
  deleteById: (momentId: string) => Promise<boolean>;
  listForMemory: (memoryId: string) => Promise<Moment[]>;
  listForBrowse: () => Promise<MomentBrowseRow[]>;
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

export interface SettingsRepository {
  getSettings: (now: Date) => Promise<AppSettings>;
  updateTranslationTargetLanguage: (input: {
    language: SupportedLanguageCode;
    updatedAt: Date;
  }) => Promise<AppSettings>;
  getOpenAiAuthCredential: () => Promise<OpenAiAuthCredential | undefined>;
  createOpenAiAuthCredential: (input: {
    provider: string;
    credentialReference: string;
    now: Date;
  }) => Promise<OpenAiAuthCredential>;
  deleteOpenAiAuthCredential: () => Promise<boolean>;
}

export interface TraumaRepositories {
  backupEnvironment: BackupEnvironmentRepository;
  moments: MomentRepository;
  memories: MemoryRepository;
  flashbacks: FlashbackRepository;
  settings: SettingsRepository;
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
    moments: {
      create: async (input) => {
        await assertMemoryExists(db, input.memoryId, "create moment for");
        const existingByAnchor = await db.query.moments.findFirst({
          where: and(
            eq(schema.moments.memoryId, input.memoryId),
            eq(schema.moments.sectionAnchor, input.sectionAnchor),
          ),
        });
        if (existingByAnchor !== undefined) {
          return { moment: existingByAnchor, alreadyExists: true };
        }

        const existingByPath = await db.query.moments.findFirst({
          where: and(
            eq(schema.moments.memoryId, input.memoryId),
            eq(schema.moments.sectionPath, input.sectionPath),
          ),
        });
        if (existingByPath !== undefined) {
          const updated = await db
            .update(schema.moments)
            .set({
              sectionAnchor: input.sectionAnchor,
              sectionTitle: input.sectionTitle,
              sectionLevel: input.sectionLevel,
              sectionStartOffset: input.sectionStartOffset ?? null,
              sectionEndOffset: input.sectionEndOffset ?? null,
              contentHash: input.contentHash ?? null,
              updatedAt: input.updatedAt,
            })
            .where(eq(schema.moments.id, existingByPath.id))
            .returning()
            .get();
          return {
            moment: updated ?? existingByPath,
            alreadyExists: true,
          };
        }

        await db
          .insert(schema.moments)
          .values(input)
          .onConflictDoNothing({
            target: [schema.moments.memoryId, schema.moments.sectionAnchor],
          })
          .run();

        const moment = await db.query.moments.findFirst({
          where: and(
            eq(schema.moments.memoryId, input.memoryId),
            eq(schema.moments.sectionAnchor, input.sectionAnchor),
          ),
        });
        if (moment === undefined) {
          throw new MemoryRepositoryError(
            `Cannot find moment after create: ${input.memoryId}#${input.sectionAnchor}`,
          );
        }
        return {
          moment,
          alreadyExists: moment.id !== input.id,
        };
      },
      deleteById: async (momentId) => {
        const deleted = await db
          .delete(schema.moments)
          .where(eq(schema.moments.id, momentId))
          .returning({ id: schema.moments.id })
          .get();
        return deleted !== undefined;
      },
      listForMemory: async (memoryId) =>
        db.query.moments.findMany({
          where: eq(schema.moments.memoryId, memoryId),
          orderBy: [desc(schema.moments.createdAt)],
        }),
      listForBrowse: async () => {
        const rows = await db
          .select({
            id: schema.moments.id,
            memoryId: schema.moments.memoryId,
            memoryTitle: schema.memories.title,
            memoryUrl: schema.memories.url,
            sectionAnchor: schema.moments.sectionAnchor,
            sectionTitle: schema.moments.sectionTitle,
            sectionLevel: schema.moments.sectionLevel,
            sectionPath: schema.moments.sectionPath,
            sectionStartOffset: schema.moments.sectionStartOffset,
            sectionEndOffset: schema.moments.sectionEndOffset,
            contentHash: schema.moments.contentHash,
            createdAt: schema.moments.createdAt,
          })
          .from(schema.moments)
          .innerJoin(
            schema.memories,
            eq(schema.moments.memoryId, schema.memories.id),
          )
          .orderBy(desc(schema.moments.createdAt));

        return rows.map((row) => ({
          ...row,
          createdAt: formatDateTime(row.createdAt),
        }));
      },
    },
    flashbacks: {
      listForMemory: async (memoryId) =>
        db.query.flashbacks.findMany({
          where: eq(schema.flashbacks.memoryId, memoryId),
          orderBy: [asc(schema.flashbacks.startOffset)],
        }),
      replaceForMemory: async (memoryId, flashbackRows) => {
        const mismatchedRow = flashbackRows.find(
          (flashback) => flashback.memoryId !== memoryId,
        );
        if (mismatchedRow !== undefined) {
          throw new MemoryRepositoryError(
            "Cannot replace flashbacks for one memory with rows from another memory.",
          );
        }

        db.transaction((tx) => {
          tx
            .delete(schema.flashbacks)
            .where(eq(schema.flashbacks.memoryId, memoryId))
            .run();

          if (flashbackRows.length > 0) {
            tx.insert(schema.flashbacks).values(flashbackRows).run();
          }
        });

        return flashbackRows;
      },
      listForBrowse: async () => {
        const rows = await db
          .select({
            id: schema.flashbacks.id,
            memoryId: schema.flashbacks.memoryId,
            memoryTitle: schema.memories.title,
            text: schema.flashbacks.text,
            prefix: schema.flashbacks.prefix,
            suffix: schema.flashbacks.suffix,
            startOffset: schema.flashbacks.startOffset,
            endOffset: schema.flashbacks.endOffset,
            contentHash: schema.flashbacks.contentHash,
            createdAt: schema.flashbacks.createdAt,
          })
          .from(schema.flashbacks)
          .innerJoin(
            schema.memories,
            eq(schema.flashbacks.memoryId, schema.memories.id),
          )
          .orderBy(desc(schema.flashbacks.createdAt));

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
      findReaderAggregateById: async (id) =>
        db.query.memories.findFirst({
          where: eq(schema.memories.id, id),
          with: {
            moments: true,
            flashbacks: true,
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
            flashbacks: {
              orderBy: [desc(schema.flashbacks.createdAt)],
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
          flashbacks: memory.flashbacks.map((flashback) => ({
            id: flashback.id,
            memoryId: memory.id,
            memoryTitle: memory.title,
            text: flashback.text,
            prefix: flashback.prefix,
            suffix: flashback.suffix,
            startOffset: flashback.startOffset,
            endOffset: flashback.endOffset,
            contentHash: flashback.contentHash,
            createdAt: formatDateTime(flashback.createdAt),
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
      createAndAttachTagToMemory: async (input) =>
        db.transaction((tx) => {
          const memory = tx
            .select({ id: schema.memories.id })
            .from(schema.memories)
            .where(eq(schema.memories.id, input.memoryId))
            .get();
          if (memory === undefined) {
            throw new MemoryRepositoryError(
              `Cannot attach tag to missing memory: ${input.memoryId}`,
            );
          }

          tx
            .insert(schema.tags)
            .values({
              id: input.id,
              name: input.name,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .onConflictDoNothing({ target: schema.tags.name })
            .run();

          const tag = tx
            .select()
            .from(schema.tags)
            .where(eq(schema.tags.name, input.name))
            .get();
          if (tag === undefined) {
            throw new MemoryRepositoryError(
              `Cannot find tag after create: ${input.name}`,
            );
          }

          tx
            .insert(schema.memoryTags)
            .values({
              memoryId: input.memoryId,
              tagId: tag.id,
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

          return tag;
        }),
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
      createAndAttachCategoryToMemory: async (input) =>
        db.transaction((tx) => {
          const memory = tx
            .select({ id: schema.memories.id })
            .from(schema.memories)
            .where(eq(schema.memories.id, input.memoryId))
            .get();
          if (memory === undefined) {
            throw new MemoryRepositoryError(
              `Cannot attach category to missing memory: ${input.memoryId}`,
            );
          }

          tx
            .insert(schema.categories)
            .values({
              id: input.id,
              name: input.name,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .onConflictDoNothing({ target: schema.categories.name })
            .run();

          const category = tx
            .select()
            .from(schema.categories)
            .where(eq(schema.categories.name, input.name))
            .get();
          if (category === undefined) {
            throw new MemoryRepositoryError(
              `Cannot find category after create: ${input.name}`,
            );
          }

          tx
            .insert(schema.memoryCategories)
            .values({
              memoryId: input.memoryId,
              categoryId: category.id,
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

          return category;
        }),
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
    settings: {
      getSettings: async (now) => getOrCreateSettings(db, now),
      updateTranslationTargetLanguage: async (input) => {
        await getOrCreateSettings(db, input.updatedAt);
        const updated = await db
          .update(schema.appSettings)
          .set({
            translationTargetLanguage: input.language,
            updatedAt: input.updatedAt,
          })
          .where(eq(schema.appSettings.id, "default"))
          .returning()
          .get();
        if (updated === undefined) {
          throw new MemoryRepositoryError("Cannot update app settings.");
        }
        return updated;
      },
      getOpenAiAuthCredential: async () =>
        db.query.openaiAuthCredentials.findFirst({
          where: eq(schema.openaiAuthCredentials.id, "default"),
        }),
      createOpenAiAuthCredential: async (input) => {
        await db
          .insert(schema.openaiAuthCredentials)
          .values({
            id: "default",
            provider: input.provider,
            credentialReference: input.credentialReference,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoNothing({ target: schema.openaiAuthCredentials.id })
          .run();
        const credential = await db.query.openaiAuthCredentials.findFirst({
          where: eq(schema.openaiAuthCredentials.id, "default"),
        });
        if (credential === undefined) {
          throw new MemoryRepositoryError("Cannot create OpenAI auth state.");
        }
        return credential;
      },
      deleteOpenAiAuthCredential: async () => {
        const deleted = await db
          .delete(schema.openaiAuthCredentials)
          .where(eq(schema.openaiAuthCredentials.id, "default"))
          .returning({ id: schema.openaiAuthCredentials.id })
          .get();
        return deleted !== undefined;
      },
    },
  };
}

async function getOrCreateSettings(
  db: TraumaDatabase,
  now: Date,
): Promise<AppSettings> {
  const existing = await db.query.appSettings.findFirst({
    where: eq(schema.appSettings.id, "default"),
  });
  if (existing !== undefined) {
    return existing;
  }

  const settings = {
    id: "default",
    translationTargetLanguage: DEFAULT_TRANSLATION_TARGET_LANGUAGE,
    createdAt: now,
    updatedAt: now,
  } satisfies typeof schema.appSettings.$inferInsert;
  await db
    .insert(schema.appSettings)
    .values(settings)
    .onConflictDoNothing({ target: schema.appSettings.id })
    .run();

  const current = await db.query.appSettings.findFirst({
    where: eq(schema.appSettings.id, "default"),
  });
  if (current === undefined) {
    throw new MemoryRepositoryError("Cannot initialize app settings.");
  }

  return current;
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
  action: "attach tag to" | "attach category to" | "create moment for",
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

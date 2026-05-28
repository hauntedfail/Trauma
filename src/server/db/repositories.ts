import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import {
  sourceFlashbackVariant,
  toFlashbackVariantColumns,
  type FlashbackVariant,
  type FlashbackVariantColumns,
} from "../flashbacks/variant";
import type { ExtractionStatus } from "../memory-status";
import {
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  type SupportedLanguageCode,
} from "../../settings/languages";
import { validateTagName } from "../../taxonomy/name-policy";
import {
  TRANSLATION_CHUNK_STATUSES,
  type TranslationChunkStatus,
  type CodexReasoningEffort,
  type TranslationJobStatus,
  type TranslationPersistedError,
  type TranslationProjectionSpan,
  type TranslationUnavailableReason,
  type TranslationValidationDiagnostic,
} from "../translation/types";
import * as schema from "./schema";

export type TraumaDatabase = BunSQLiteDatabase<typeof schema>;
type Memory = typeof schema.memories.$inferSelect;
type NewMemory = typeof schema.memories.$inferInsert;
type Tag = typeof schema.tags.$inferSelect;
type Category = typeof schema.categories.$inferSelect;
type Moment = typeof schema.moments.$inferSelect;
type NewMoment = typeof schema.moments.$inferInsert;
export type Flashback = typeof schema.flashbacks.$inferSelect;
type AppSettings = typeof schema.appSettings.$inferSelect;
type OpenAiAuthCredential = typeof schema.openaiAuthCredentials.$inferSelect;
type TranslationJob = typeof schema.translationJobs.$inferSelect;
type TranslationChunk = typeof schema.translationChunks.$inferSelect;
type TranslationProjectionSpanRow =
  typeof schema.translationProjectionSpans.$inferSelect;
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
type ReaderMemoryRow = Pick<
  Memory,
  | "id"
  | "url"
  | "title"
  | "description"
  | "faviconUrl"
  | "extractionStatus"
  | "contentPath"
  | "read"
  | "createdAt"
  | "updatedAt"
>;
type ReaderMomentRow = Pick<
  Moment,
  | "id"
  | "sectionAnchor"
  | "sectionTitle"
  | "sectionLevel"
  | "sectionPath"
  | "sectionStartOffset"
  | "sectionEndOffset"
  | "contentHash"
  | "createdAt"
>;
type TaxonomyLabelRow = Pick<Tag | Category, "id" | "name">;
export type ReaderMemoryAggregateRow = ReaderMemoryRow & {
  moments: ReaderMomentRow[];
  memoryCategories: { category: TaxonomyLabelRow }[];
  memoryTags: { tag: TaxonomyLabelRow }[];
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

export interface MemoryBrowsePageRow {
  id: string;
  title: string;
  url: string;
  description: string;
  capturedAt: string;
  read: boolean;
  extractionStatus: ExtractionStatus;
  categories: { id: string; name: string }[];
  tags: { id: string; name: string }[];
}

export type MemoryBrowseSearchField =
  | "title"
  | "url"
  | "tag"
  | "category"
  | "flashback";

export interface ListMemoryBrowsePageInput {
  categoryId: string;
  cursor: { createdAt: Date; id: string } | null;
  flashbackId: string;
  limit: number;
  readState: "all" | "both" | "read" | "unread";
  searchFields: {
    field: MemoryBrowseSearchField;
    values: string[];
  }[];
  searchTerms: string[];
  tagId: string;
}

export interface MemoryBrowsePageResult {
  rows: MemoryBrowsePageRow[];
  nextCursor: { createdAt: Date; id: string } | null;
}

export interface FlashbackBrowseRow {
  id: string;
  memoryId: string;
  memoryTitle: string;
  variantKind: "source" | "translation";
  langCode: SupportedLanguageCode | null;
  translationOutputHash: string | null;
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
  listForBrowsePage: (input: ListMemoryBrowsePageInput) => Promise<MemoryBrowsePageResult>;
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
  findAttachedTagByName: (input: {
    memoryId: string;
    name: string;
  }) => Promise<Tag | undefined>;
  findCategoryByName: (name: string) => Promise<Category | undefined>;
  attachTagToMemory: (input: {
    memoryId: string;
    tagId: string;
    now: Date;
  }) => Promise<void>;
  detachTagFromMemory: (input: {
    memoryId: string;
    tagId: string;
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
  listForMemoryVariant: (input: {
    memoryId: string;
    variant: FlashbackVariant;
  }) => Promise<Flashback[]>;
  replaceForMemoryVariant: (input: {
    memoryId: string;
    variant: FlashbackVariant;
    flashbacks: Flashback[];
  }) => Promise<Flashback[]>;
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

export type TranslationJobRecord = Omit<TranslationJob, "error"> & {
  error: TranslationPersistedError | null;
};

export type TranslationChunkRecord = Omit<
  TranslationChunk,
  "blockIdsJson" | "error"
> & {
  blockIds: string[];
  error: TranslationPersistedError | null;
};

export interface CreateTranslationJobInput {
  jobId: string;
  memoryId: string;
  langCode: string;
  sourceHash: string;
  model: string | null;
  reasoningEffort?: CodexReasoningEffort | null;
  promptPolicyVersion: string;
  chunkerVersion: string;
  chunkCount: number;
  now: Date;
}

export interface InsertTranslationChunkInput {
  chunkIndex: number;
  sourceChunkHash: string;
  blockIds: string[];
  status: TranslationChunkStatus;
  now: Date;
}

export interface TranslationChunkPatch {
  status?: TranslationChunkStatus;
  retryCount?: number;
  projectionSpansJson?: string | null;
  translatedMarkdown?: string | null;
  translatedHash?: string | null;
  error?: TranslationPersistedError | null;
  updatedAt: Date;
}

export interface TranslationJobPatch {
  chunkCount?: number;
  outputPath?: string | null;
  outputHash?: string | null;
  error?: TranslationPersistedError | null;
  completedAt?: Date | null;
  updatedAt: Date;
}

export interface TranslationRepository {
  createTranslationJob: (
    input: CreateTranslationJobInput,
  ) => Promise<TranslationJobRecord>;
  getTranslationJob: (jobId: string) => Promise<TranslationJobRecord | null>;
  findCompleteTranslationRecord: (
    memoryId: string,
    langCode: string,
    sourceHash: string,
  ) => Promise<TranslationJobRecord | null>;
  listCompleteTranslationRecordsForMemory: (
    memoryId: string,
  ) => Promise<TranslationJobRecord[]>;
  findActiveTranslationJob: (
    memoryId: string,
    langCode: string,
    sourceHash: string,
  ) => Promise<TranslationJobRecord | null>;
  updateTranslationJobStatus: (
    jobId: string,
    status: TranslationJobStatus,
    patch: TranslationJobPatch,
  ) => Promise<void>;
  transitionTranslationJobStatus: (
    jobId: string,
    expectedStatus: TranslationJobStatus,
    status: TranslationJobStatus,
    patch: TranslationJobPatch,
  ) => Promise<boolean>;
  claimTranslationJob: (
    jobId: string,
    expectedStatus: "pending",
    updatedAt: Date,
  ) => Promise<boolean>;
  cancelPendingTranslationJob: (
    jobId: string,
    updatedAt: Date,
  ) => Promise<boolean>;
  requestRunningTranslationJobCancellation: (
    jobId: string,
    updatedAt: Date,
  ) => Promise<boolean>;
  markTranslationUnavailable: (
    jobId: string,
    reason: TranslationUnavailableReason,
    updatedAt: Date,
  ) => Promise<void>;
  insertTranslationChunks: (
    jobId: string,
    chunks: InsertTranslationChunkInput[],
  ) => Promise<void>;
  getTranslationChunks: (jobId: string) => Promise<TranslationChunkRecord[]>;
  updateTranslationChunk: (
    jobId: string,
    chunkIndex: number,
    patch: TranslationChunkPatch,
  ) => Promise<void>;
  purgeCompletedTranslationChunks: (
    jobId: string,
    updatedAt: Date,
  ) => Promise<void>;
  countTranslationChunksByStatus: (
    jobId: string,
  ) => Promise<Record<TranslationChunkStatus, number>>;
  deleteProjectionSpansForJob: (jobId: string) => Promise<void>;
  listCurrentProjectionSpans: (input: {
    langCode: SupportedLanguageCode;
    memoryId: string;
    outputHash: string;
    sourceHash: string;
  }) => Promise<TranslationProjectionSpan[]>;
  replaceProjectionSpansForJob: (
    jobId: string,
    spans: TranslationProjectionSpan[],
  ) => Promise<void>;
  getTranslationTargetLanguage: () => Promise<SupportedLanguageCode | null>;
  setTranslationTargetLanguage: (
    langCode: SupportedLanguageCode,
    updatedAt: Date,
  ) => Promise<void>;
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
  updateCodexTranslationDefaults: (input: {
    model: string | null;
    reasoningEffort: CodexReasoningEffort | null;
    updatedAt: Date;
  }) => Promise<AppSettings>;
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
  translations: TranslationRepository;
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
        const existingByPath = await db.query.moments.findFirst({
          where: and(
            eq(schema.moments.memoryId, input.memoryId),
            eq(schema.moments.sectionPath, input.sectionPath),
          ),
        });
        if (existingByPath !== undefined) {
          const updated = db.transaction((tx) => {
            if (existingByPath.sectionAnchor !== input.sectionAnchor) {
              const existingByAnchor = tx
                .select()
                .from(schema.moments)
                .where(
                  and(
                    eq(schema.moments.memoryId, input.memoryId),
                    eq(schema.moments.sectionAnchor, input.sectionAnchor),
                  ),
                )
                .get();
              if (
                existingByAnchor !== undefined &&
                existingByAnchor.id !== existingByPath.id
              ) {
                tx
                  .delete(schema.moments)
                  .where(eq(schema.moments.id, existingByAnchor.id))
                  .run();
              }
            }

            return tx
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
          });
          return {
            moment: updated ?? existingByPath,
            alreadyExists: true,
          };
        }

        const existingByAnchor = await db.query.moments.findFirst({
          where: and(
            eq(schema.moments.memoryId, input.memoryId),
            eq(schema.moments.sectionAnchor, input.sectionAnchor),
          ),
        });
        if (existingByAnchor !== undefined) {
          if (existingByAnchor.sectionPath === input.sectionPath) {
            return { moment: existingByAnchor, alreadyExists: true };
          }

          const updated = await db
            .update(schema.moments)
            .set({
              sectionTitle: input.sectionTitle,
              sectionLevel: input.sectionLevel,
              sectionPath: input.sectionPath,
              sectionStartOffset: input.sectionStartOffset ?? null,
              sectionEndOffset: input.sectionEndOffset ?? null,
              contentHash: input.contentHash ?? null,
              updatedAt: input.updatedAt,
            })
            .where(eq(schema.moments.id, existingByAnchor.id))
            .returning()
            .get();
          return {
            moment: updated ?? existingByAnchor,
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
        listFlashbacksForMemoryVariant(db, {
          memoryId,
          variant: sourceFlashbackVariant,
        }),
      replaceForMemory: async (memoryId, flashbackRows) =>
        replaceFlashbacksForMemoryVariant(db, {
          memoryId,
          variant: sourceFlashbackVariant,
          flashbacks: flashbackRows,
        }),
      listForMemoryVariant: async (input) =>
        listFlashbacksForMemoryVariant(db, input),
      replaceForMemoryVariant: async (input) =>
        replaceFlashbacksForMemoryVariant(db, input),
      listForBrowse: async () => {
        const rows = await db
          .select({
            id: schema.flashbacks.id,
            memoryId: schema.flashbacks.memoryId,
            memoryTitle: schema.memories.title,
            variantKind: schema.flashbacks.variantKind,
            langCode: schema.flashbacks.langCode,
            translationOutputHash: schema.flashbacks.translationOutputHash,
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
          columns: {
            id: true,
            url: true,
            title: true,
            description: true,
            faviconUrl: true,
            extractionStatus: true,
            contentPath: true,
            read: true,
            createdAt: true,
            updatedAt: true,
          },
          where: eq(schema.memories.id, id),
          with: {
            moments: {
              columns: {
                id: true,
                sectionAnchor: true,
                sectionTitle: true,
                sectionLevel: true,
                sectionPath: true,
                sectionStartOffset: true,
                sectionEndOffset: true,
                contentHash: true,
                createdAt: true,
              },
            },
            memoryCategories: {
              with: {
                category: {
                  columns: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
            memoryTags: {
              with: {
                tag: {
                  columns: {
                    id: true,
                    name: true,
                  },
                },
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
      listForBrowsePage: async (input) => listMemoryBrowsePage(db, input),
      listForBrowse: async () => {
        const rows = await db.query.memories.findMany({
          columns: {
            id: true,
            title: true,
            url: true,
            description: true,
            createdAt: true,
            read: true,
            extractionStatus: true,
          },
          orderBy: [desc(schema.memories.createdAt)],
          with: {
            flashbacks: {
              columns: {
                id: true,
                variantKind: true,
                langCode: true,
                translationOutputHash: true,
                text: true,
                prefix: true,
                suffix: true,
                startOffset: true,
                endOffset: true,
                contentHash: true,
                createdAt: true,
              },
              orderBy: [desc(schema.flashbacks.createdAt)],
            },
            memoryCategories: {
              with: {
                category: {
                  columns: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
            memoryTags: {
              with: {
                tag: {
                  columns: {
                    id: true,
                    name: true,
                  },
                },
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
            variantKind: flashback.variantKind,
            langCode: flashback.langCode,
            translationOutputHash: flashback.translationOutputHash,
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
        const name = requireValidTagName(input.name);
        const existing = await findTagByName(db, name);
        if (existing !== undefined) {
          return existing;
        }

        await db
          .insert(schema.tags)
          .values({
            id: input.id,
            name,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoNothing({ target: schema.tags.name })
          .run();
        return requireTagByName(db, name);
      },
      createAndAttachTagToMemory: async (input) =>
        db.transaction((tx) => {
          const name = normalizeTaxonomyLookupName(input.name);
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

          const attachedTag =
            tx
              .select({
                id: schema.tags.id,
                name: schema.tags.name,
                createdAt: schema.tags.createdAt,
                updatedAt: schema.tags.updatedAt,
              })
              .from(schema.tags)
              .innerJoin(
                schema.memoryTags,
                eq(schema.tags.id, schema.memoryTags.tagId),
              )
              .where(
                and(
                  eq(schema.memoryTags.memoryId, input.memoryId),
                  eq(schema.tags.name, name),
                ),
              )
              .get() ??
            tx
              .select({
                id: schema.tags.id,
                name: schema.tags.name,
                createdAt: schema.tags.createdAt,
                updatedAt: schema.tags.updatedAt,
              })
              .from(schema.tags)
              .innerJoin(
                schema.memoryTags,
                eq(schema.tags.id, schema.memoryTags.tagId),
              )
              .where(
                and(
                  eq(schema.memoryTags.memoryId, input.memoryId),
                  taxonomyNameEquals(schema.tags.name, name),
                ),
              )
              .get();
          if (attachedTag !== undefined) {
            return attachedTag;
          }

          let tag =
            tx.select().from(schema.tags).where(eq(schema.tags.name, name)).get() ??
            tx
              .select()
              .from(schema.tags)
              .where(taxonomyNameEquals(schema.tags.name, name))
              .get();
          if (tag === undefined) {
            const validName = requireValidTagName(name);
            tx
              .insert(schema.tags)
              .values({
                id: input.id,
                name: validName,
                createdAt: input.now,
                updatedAt: input.now,
              })
              .onConflictDoNothing({ target: schema.tags.name })
              .run();

            tag =
              tx
                .select()
                .from(schema.tags)
                .where(eq(schema.tags.name, validName))
                .get() ??
              tx
                .select()
                .from(schema.tags)
                .where(taxonomyNameEquals(schema.tags.name, validName))
                .get();
          }
          if (tag === undefined) {
            throw new MemoryRepositoryError(
              `Cannot find tag after create: ${name}`,
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
        const existing = await findCategoryByName(db, input.name);
        if (existing !== undefined) {
          return existing;
        }

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
          const name = normalizeTaxonomyLookupName(input.name);
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

          let category =
            tx
              .select()
              .from(schema.categories)
              .where(eq(schema.categories.name, name))
              .get() ??
            tx
              .select()
              .from(schema.categories)
              .where(taxonomyNameEquals(schema.categories.name, name))
              .get();
          if (category === undefined) {
            tx
              .insert(schema.categories)
              .values({
                id: input.id,
                name,
                createdAt: input.now,
                updatedAt: input.now,
              })
              .onConflictDoNothing({ target: schema.categories.name })
              .run();

            category =
              tx
                .select()
                .from(schema.categories)
                .where(eq(schema.categories.name, name))
                .get() ??
              tx
                .select()
                .from(schema.categories)
                .where(taxonomyNameEquals(schema.categories.name, name))
                .get();
          }
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
        findTagByName(db, name),
      findAttachedTagByName: async (input) =>
        findAttachedTagByName(db, input.memoryId, input.name),
      findCategoryByName: async (name) =>
        findCategoryByName(db, name),
      attachTagToMemory: async (input) => {
        await assertMemoryExists(db, input.memoryId, "attach tag to");
        await requireTagById(db, input.tagId);
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
      detachTagFromMemory: async (input) => {
        await assertMemoryExists(db, input.memoryId, "detach tag from");
        await assertTagExists(db, input.tagId);
        await db
          .delete(schema.memoryTags)
          .where(
            and(
              eq(schema.memoryTags.memoryId, input.memoryId),
              eq(schema.memoryTags.tagId, input.tagId),
            ),
          )
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
    translations: {
      createTranslationJob: async (input) => {
        await assertMemoryExists(db, input.memoryId, "create translation for");
        const row = await db
          .insert(schema.translationJobs)
          .values({
            jobId: input.jobId,
            memoryId: input.memoryId,
            langCode: input.langCode,
            sourceHash: input.sourceHash,
            model: input.model,
            reasoningEffort: input.reasoningEffort ?? null,
            promptPolicyVersion: input.promptPolicyVersion,
            chunkerVersion: input.chunkerVersion,
            status: "pending",
            chunkCount: input.chunkCount,
            outputPath: null,
            outputHash: null,
            error: null,
            completedAt: null,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning()
          .get();
        return toTranslationJobRecord(row);
      },
      getTranslationJob: async (jobId) => {
        const row = await db.query.translationJobs.findFirst({
          where: eq(schema.translationJobs.jobId, jobId),
        });
        return row === undefined ? null : toTranslationJobRecord(row);
      },
      findCompleteTranslationRecord: async (memoryId, langCode, sourceHash) => {
        const row = await db.query.translationJobs.findFirst({
          where: and(
            eq(schema.translationJobs.memoryId, memoryId),
            eq(schema.translationJobs.langCode, langCode),
            eq(schema.translationJobs.sourceHash, sourceHash),
            eq(schema.translationJobs.status, "complete"),
          ),
        });
        return row === undefined ? null : toTranslationJobRecord(row);
      },
      listCompleteTranslationRecordsForMemory: async (memoryId) => {
        const rows = await db.query.translationJobs.findMany({
          where: and(
            eq(schema.translationJobs.memoryId, memoryId),
            eq(schema.translationJobs.status, "complete"),
          ),
          orderBy: [
            asc(schema.translationJobs.langCode),
            desc(schema.translationJobs.updatedAt),
          ],
        });
        return rows.map(toTranslationJobRecord);
      },
      findActiveTranslationJob: async (memoryId, langCode, sourceHash) => {
        const row = await db.query.translationJobs.findFirst({
          where: and(
            eq(schema.translationJobs.memoryId, memoryId),
            eq(schema.translationJobs.langCode, langCode),
            eq(schema.translationJobs.sourceHash, sourceHash),
            inArray(schema.translationJobs.status, [
              "pending",
              "running",
              "cancel_requested",
              "stitching",
              "committing",
            ]),
          ),
        });
        return row === undefined ? null : toTranslationJobRecord(row);
      },
      updateTranslationJobStatus: async (jobId, status, patch) => {
        await db
          .update(schema.translationJobs)
          .set({
            status,
            chunkCount: patch.chunkCount,
            outputPath: patch.outputPath,
            outputHash: patch.outputHash,
            error: serializeTranslationError(patch.error),
            completedAt: patch.completedAt,
            updatedAt: patch.updatedAt,
          })
          .where(eq(schema.translationJobs.jobId, jobId))
          .run();
      },
      transitionTranslationJobStatus: async (jobId, expectedStatus, status, patch) => {
        const updated = await db
          .update(schema.translationJobs)
          .set({
            status,
            chunkCount: patch.chunkCount,
            outputPath: patch.outputPath,
            outputHash: patch.outputHash,
            error: serializeTranslationError(patch.error),
            completedAt: patch.completedAt,
            updatedAt: patch.updatedAt,
          })
          .where(
            and(
              eq(schema.translationJobs.jobId, jobId),
              eq(schema.translationJobs.status, expectedStatus),
            ),
          )
          .returning({ jobId: schema.translationJobs.jobId })
          .get();
        return updated !== undefined;
      },
      claimTranslationJob: async (jobId, expectedStatus, updatedAt) => {
        const updated = await db
          .update(schema.translationJobs)
          .set({
            status: "running",
            updatedAt,
          })
          .where(
            and(
              eq(schema.translationJobs.jobId, jobId),
              eq(schema.translationJobs.status, expectedStatus),
            ),
          )
          .returning({ jobId: schema.translationJobs.jobId })
          .get();
        return updated !== undefined;
      },
      cancelPendingTranslationJob: async (jobId, updatedAt) => {
        const updated = await db
          .update(schema.translationJobs)
          .set({
            status: "canceled",
            updatedAt,
            completedAt: updatedAt,
          })
          .where(
            and(
              eq(schema.translationJobs.jobId, jobId),
              eq(schema.translationJobs.status, "pending"),
            ),
          )
          .returning({ jobId: schema.translationJobs.jobId })
          .get();
        return updated !== undefined;
      },
      requestRunningTranslationJobCancellation: async (jobId, updatedAt) => {
        const updated = await db
          .update(schema.translationJobs)
          .set({
            status: "cancel_requested",
            updatedAt,
          })
          .where(
            and(
              eq(schema.translationJobs.jobId, jobId),
              eq(schema.translationJobs.status, "running"),
            ),
          )
          .returning({ jobId: schema.translationJobs.jobId })
          .get();
        return updated !== undefined;
      },
      markTranslationUnavailable: async (jobId, reason, updatedAt) => {
        await db
          .update(schema.translationJobs)
          .set({
            status: "unavailable",
            outputPath: null,
            error: serializeTranslationError({
              code: "translation_unavailable",
              message:
                "The translated output is no longer available. Start a new translation.",
              action: "start_fresh_translation",
              reason,
            }),
            updatedAt,
          })
          .where(eq(schema.translationJobs.jobId, jobId))
          .run();
      },
      insertTranslationChunks: async (jobId, chunks) => {
        if (chunks.length === 0) {
          return;
        }

        await db
          .insert(schema.translationChunks)
          .values(
            chunks.map((chunk) => ({
              jobId,
              chunkIndex: chunk.chunkIndex,
              sourceChunkHash: chunk.sourceChunkHash,
              blockIdsJson: serializeBlockIds(chunk.blockIds),
              status: chunk.status,
              retryCount: 0,
              translatedMarkdown: null,
              translatedHash: null,
              error: null,
              createdAt: chunk.now,
              updatedAt: chunk.now,
            })),
          )
          .run();
      },
      getTranslationChunks: async (jobId) => {
        const rows = await db.query.translationChunks.findMany({
          where: eq(schema.translationChunks.jobId, jobId),
          orderBy: [asc(schema.translationChunks.chunkIndex)],
        });
        return rows.map(toTranslationChunkRecord);
      },
      updateTranslationChunk: async (jobId, chunkIndex, patch) => {
        await db
          .update(schema.translationChunks)
          .set({
            status: patch.status,
            retryCount: patch.retryCount,
            projectionSpansJson: patch.projectionSpansJson,
            translatedMarkdown: patch.translatedMarkdown,
            translatedHash: patch.translatedHash,
            error: serializeTranslationError(patch.error),
            updatedAt: patch.updatedAt,
          })
          .where(
            and(
              eq(schema.translationChunks.jobId, jobId),
              eq(schema.translationChunks.chunkIndex, chunkIndex),
            ),
          )
          .run();
      },
      purgeCompletedTranslationChunks: async (jobId, updatedAt) => {
        await db
          .update(schema.translationChunks)
          .set({
            status: "purged",
            projectionSpansJson: null,
            translatedMarkdown: null,
            updatedAt,
          })
          .where(
            and(
              eq(schema.translationChunks.jobId, jobId),
              eq(schema.translationChunks.status, "complete"),
            ),
          )
          .run();
      },
      countTranslationChunksByStatus: async (jobId) => {
        const counts = createEmptyTranslationChunkCounts();
        const rows = await db
          .select({
            status: schema.translationChunks.status,
            count: sql<number>`count(*)`,
          })
          .from(schema.translationChunks)
          .where(eq(schema.translationChunks.jobId, jobId))
          .groupBy(schema.translationChunks.status);
        for (const row of rows) {
          counts[row.status] = Number(row.count);
        }
        return counts;
      },
      deleteProjectionSpansForJob: async (jobId) => {
        await db
          .delete(schema.translationProjectionSpans)
          .where(eq(schema.translationProjectionSpans.jobId, jobId))
          .run();
      },
      listCurrentProjectionSpans: async (input) => {
        const rows = await db.query.translationProjectionSpans.findMany({
          where: and(
            eq(schema.translationProjectionSpans.memoryId, input.memoryId),
            eq(schema.translationProjectionSpans.langCode, input.langCode),
            eq(schema.translationProjectionSpans.sourceHash, input.sourceHash),
            eq(schema.translationProjectionSpans.outputHash, input.outputHash),
          ),
          orderBy: [asc(schema.translationProjectionSpans.spanIndex)],
        });
        return rows.map(toTranslationProjectionSpanRecord);
      },
      replaceProjectionSpansForJob: async (jobId, spans) => {
        const mismatched = spans.find((span) => span.jobId !== jobId);
        if (mismatched !== undefined) {
          throw new MemoryRepositoryError(
            "Cannot replace projection spans for a different translation job.",
          );
        }

        db.transaction((tx) => {
          tx
            .delete(schema.translationProjectionSpans)
            .where(eq(schema.translationProjectionSpans.jobId, jobId))
            .run();
          if (spans.length > 0) {
            tx.insert(schema.translationProjectionSpans).values(spans).run();
          }
        });
      },
      getTranslationTargetLanguage: async () => {
        const settings = await db.query.appSettings.findFirst({
          where: eq(schema.appSettings.id, "default"),
        });
        return settings?.translationTargetLanguage ?? null;
      },
      setTranslationTargetLanguage: async (langCode, updatedAt) => {
        await getOrCreateSettings(db, updatedAt);
        await db
          .update(schema.appSettings)
          .set({
            translationTargetLanguage: langCode,
            updatedAt,
          })
          .where(eq(schema.appSettings.id, "default"))
          .run();
      },
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
      updateCodexTranslationDefaults: async (input) => {
        await getOrCreateSettings(db, input.updatedAt);
        const updated = await db
          .update(schema.appSettings)
          .set({
            codexTranslationModel: input.model,
            codexTranslationReasoningEffort: input.reasoningEffort,
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

async function listMemoryBrowsePage(
  db: TraumaDatabase,
  input: ListMemoryBrowsePageInput,
): Promise<MemoryBrowsePageResult> {
  if (input.readState === "both") {
    return { rows: [], nextCursor: null };
  }

  const limit = normalizeBrowsePageLimit(input.limit);
  const fetchedRows = await db
    .select({
      id: schema.memories.id,
      title: schema.memories.title,
      url: schema.memories.url,
      description: schema.memories.description,
      createdAt: schema.memories.createdAt,
      read: schema.memories.read,
      extractionStatus: schema.memories.extractionStatus,
    })
    .from(schema.memories)
    .where(buildMemoryBrowsePageWhere(input))
    .orderBy(desc(schema.memories.createdAt), desc(schema.memories.id))
    .limit(limit + 1);

  const pageRows = fetchedRows.slice(0, limit);
  const lastPageRow = pageRows[pageRows.length - 1];
  const nextCursor =
    fetchedRows.length > limit && lastPageRow !== undefined
      ? { createdAt: lastPageRow.createdAt, id: lastPageRow.id }
      : null;
  const memoryIds = pageRows.map((row) => row.id);
  const [categoriesByMemoryId, tagsByMemoryId] = await Promise.all([
    listBrowsePageCategoriesByMemoryId(db, memoryIds),
    listBrowsePageTagsByMemoryId(db, memoryIds),
  ]);

  return {
    rows: pageRows.map((memory) => ({
      id: memory.id,
      title: memory.title,
      url: memory.url,
      description: memory.description ?? "",
      capturedAt: formatDate(memory.createdAt),
      read: memory.read,
      extractionStatus: memory.extractionStatus,
      categories: categoriesByMemoryId.get(memory.id) ?? [],
      tags: tagsByMemoryId.get(memory.id) ?? [],
    })),
    nextCursor,
  };
}

function normalizeBrowsePageLimit(limit: number): number {
  const normalized = Math.trunc(limit);
  if (!Number.isFinite(normalized) || normalized < 1) {
    return 1;
  }

  return Math.min(normalized, 100);
}

function buildMemoryBrowsePageWhere(
  input: ListMemoryBrowsePageInput,
): SQL | undefined {
  const filters: SQL[] = [];

  if (input.cursor !== null) {
    const cursorCreatedAt = input.cursor.createdAt.getTime();
    filters.push(
      sql`(${schema.memories.createdAt} < ${cursorCreatedAt} or (${schema.memories.createdAt} = ${cursorCreatedAt} and ${schema.memories.id} < ${input.cursor.id}))`,
    );
  }

  if (input.readState === "read") {
    filters.push(eq(schema.memories.read, true));
  } else if (input.readState === "unread") {
    filters.push(eq(schema.memories.read, false));
  }

  if (input.categoryId.length > 0) {
    filters.push(memoryHasCategoryId(input.categoryId));
  }

  if (input.tagId.length > 0) {
    filters.push(memoryHasTagId(input.tagId));
  }

  if (input.flashbackId.length > 0) {
    filters.push(memoryHasFlashbackId(input.flashbackId));
  }

  for (const term of input.searchTerms.map(normalizeBrowseSearchValue)) {
    if (term.length > 0) {
      filters.push(memoryMatchesFreeSearchTerm(term));
    }
  }

  for (const field of input.searchFields) {
    for (const value of field.values.map(normalizeBrowseSearchValue)) {
      if (value.length > 0) {
        filters.push(memoryMatchesFieldSearchValue(field.field, value));
      }
    }
  }

  return and(...filters);
}

function memoryHasCategoryId(categoryId: string): SQL {
  return sql`exists (
    select 1 from ${schema.memoryCategories}
    where ${schema.memoryCategories.memoryId} = ${schema.memories.id}
      and ${schema.memoryCategories.categoryId} = ${categoryId}
  )`;
}

function memoryHasTagId(tagId: string): SQL {
  return sql`exists (
    select 1 from ${schema.memoryTags}
    where ${schema.memoryTags.memoryId} = ${schema.memories.id}
      and ${schema.memoryTags.tagId} = ${tagId}
  )`;
}

function memoryHasFlashbackId(flashbackId: string): SQL {
  return sql`exists (
    select 1 from ${schema.flashbacks}
    where ${schema.flashbacks.memoryId} = ${schema.memories.id}
      and ${schema.flashbacks.id} = ${flashbackId}
  )`;
}

function memoryMatchesFreeSearchTerm(term: string): SQL {
  return (
    or(
      likeInsensitive(schema.memories.title, term),
      likeInsensitive(schema.memories.url, term),
      likeInsensitive(schema.memories.description, term),
      memoryHasCategoryNameLike(term),
      memoryHasTagNameLike(term),
      memoryHasFlashbackTextLike(term),
    ) ?? sql`0 = 1`
  );
}

function memoryMatchesFieldSearchValue(
  field: MemoryBrowseSearchField,
  value: string,
): SQL {
  switch (field) {
    case "title":
      return likeInsensitive(schema.memories.title, value);
    case "url":
      return likeInsensitive(schema.memories.url, value);
    case "tag":
      return memoryHasTagName(value);
    case "category":
      return memoryHasCategoryName(value);
    case "flashback":
      return memoryHasFlashbackTextLike(value);
  }
}

function memoryHasCategoryName(value: string): SQL {
  return sql`exists (
    select 1 from ${schema.memoryCategories}
    inner join ${schema.categories}
      on ${schema.categories.id} = ${schema.memoryCategories.categoryId}
    where ${schema.memoryCategories.memoryId} = ${schema.memories.id}
      and lower(${schema.categories.name}) = ${value}
  )`;
}

function memoryHasTagName(value: string): SQL {
  return sql`exists (
    select 1 from ${schema.memoryTags}
    inner join ${schema.tags}
      on ${schema.tags.id} = ${schema.memoryTags.tagId}
    where ${schema.memoryTags.memoryId} = ${schema.memories.id}
      and lower(${schema.tags.name}) = ${value}
  )`;
}

function memoryHasCategoryNameLike(value: string): SQL {
  return sql`exists (
    select 1 from ${schema.memoryCategories}
    inner join ${schema.categories}
      on ${schema.categories.id} = ${schema.memoryCategories.categoryId}
    where ${schema.memoryCategories.memoryId} = ${schema.memories.id}
      and ${likeInsensitive(schema.categories.name, value)}
  )`;
}

function memoryHasTagNameLike(value: string): SQL {
  return sql`exists (
    select 1 from ${schema.memoryTags}
    inner join ${schema.tags}
      on ${schema.tags.id} = ${schema.memoryTags.tagId}
    where ${schema.memoryTags.memoryId} = ${schema.memories.id}
      and ${likeInsensitive(schema.tags.name, value)}
  )`;
}

function memoryHasFlashbackTextLike(value: string): SQL {
  return sql`exists (
    select 1 from ${schema.flashbacks}
    where ${schema.flashbacks.memoryId} = ${schema.memories.id}
      and (
        ${likeInsensitive(schema.flashbacks.text, value)}
        or ${likeInsensitive(schema.flashbacks.prefix, value)}
        or ${likeInsensitive(schema.flashbacks.suffix, value)}
      )
  )`;
}

function likeInsensitive(
  column:
    | typeof schema.memories.title
    | typeof schema.memories.url
    | typeof schema.memories.description
    | typeof schema.categories.name
    | typeof schema.tags.name
    | typeof schema.flashbacks.text
    | typeof schema.flashbacks.prefix
    | typeof schema.flashbacks.suffix,
  value: string,
): SQL {
  return sql`lower(${column}) like ${`%${escapeSqlLikeValue(value)}%`} escape '\\'`;
}

function escapeSqlLikeValue(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function normalizeBrowseSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

async function listBrowsePageCategoriesByMemoryId(
  db: TraumaDatabase,
  memoryIds: string[],
): Promise<Map<string, { id: string; name: string }[]>> {
  const grouped = createEmptyTaxonomyMap(memoryIds);
  if (memoryIds.length === 0) {
    return grouped;
  }

  const rows = await db
    .select({
      memoryId: schema.memoryCategories.memoryId,
      id: schema.categories.id,
      name: schema.categories.name,
    })
    .from(schema.memoryCategories)
    .innerJoin(
      schema.categories,
      eq(schema.categories.id, schema.memoryCategories.categoryId),
    )
    .where(inArray(schema.memoryCategories.memoryId, memoryIds))
    .orderBy(asc(schema.categories.name), asc(schema.categories.id));

  for (const row of rows) {
    grouped.get(row.memoryId)?.push({ id: row.id, name: row.name });
  }

  return grouped;
}

async function listBrowsePageTagsByMemoryId(
  db: TraumaDatabase,
  memoryIds: string[],
): Promise<Map<string, { id: string; name: string }[]>> {
  const grouped = createEmptyTaxonomyMap(memoryIds);
  if (memoryIds.length === 0) {
    return grouped;
  }

  const rows = await db
    .select({
      memoryId: schema.memoryTags.memoryId,
      id: schema.tags.id,
      name: schema.tags.name,
    })
    .from(schema.memoryTags)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.memoryTags.tagId))
    .where(inArray(schema.memoryTags.memoryId, memoryIds))
    .orderBy(asc(schema.tags.name), asc(schema.tags.id));

  for (const row of rows) {
    grouped.get(row.memoryId)?.push({ id: row.id, name: row.name });
  }

  return grouped;
}

function createEmptyTaxonomyMap(
  memoryIds: string[],
): Map<string, { id: string; name: string }[]> {
  return new Map(memoryIds.map((memoryId) => [memoryId, []]));
}

function listFlashbacksForMemoryVariant(
  db: TraumaDatabase,
  input: {
    memoryId: string;
    variant: FlashbackVariant;
  },
): Promise<Flashback[]> {
  return db.query.flashbacks.findMany({
    where: flashbackVariantWhere(input.memoryId, input.variant),
    orderBy: [asc(schema.flashbacks.startOffset)],
  });
}

async function replaceFlashbacksForMemoryVariant(
  db: TraumaDatabase,
  input: {
    memoryId: string;
    variant: FlashbackVariant;
    flashbacks: Flashback[];
  },
): Promise<Flashback[]> {
  const columns = toFlashbackVariantColumns(input.variant);
  const mismatchedRow = input.flashbacks.find(
    (flashback) =>
      flashback.memoryId !== input.memoryId ||
      flashback.variantKind !== columns.variantKind ||
      flashback.langCode !== columns.langCode ||
      flashback.translationOutputHash !== columns.translationOutputHash,
  );
  if (mismatchedRow !== undefined) {
    throw new MemoryRepositoryError(
      "Cannot replace flashbacks for one memory variant with rows from another memory variant.",
    );
  }

  db.transaction((tx) => {
    tx
      .delete(schema.flashbacks)
      .where(flashbackVariantWhere(input.memoryId, input.variant))
      .run();

    if (input.flashbacks.length > 0) {
      tx.insert(schema.flashbacks).values(input.flashbacks).run();
    }
  });

  return input.flashbacks;
}

function flashbackVariantWhere(memoryId: string, variant: FlashbackVariant) {
  const columns = toFlashbackVariantColumns(variant);
  return and(
    eq(schema.flashbacks.memoryId, memoryId),
    eq(schema.flashbacks.variantKind, columns.variantKind),
    columns.langCode === null
      ? isNull(schema.flashbacks.langCode)
      : eq(schema.flashbacks.langCode, columns.langCode),
    columns.translationOutputHash === null
      ? isNull(schema.flashbacks.translationOutputHash)
      : eq(schema.flashbacks.translationOutputHash, columns.translationOutputHash),
  );
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
    codexTranslationModel: null,
    codexTranslationReasoningEffort: null,
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

function toTranslationJobRecord(row: TranslationJob): TranslationJobRecord {
  return {
    ...row,
    error: parseTranslationError(row.error),
  };
}

function toTranslationChunkRecord(
  row: TranslationChunk,
): TranslationChunkRecord {
  const { blockIdsJson, error, ...rest } = row;
  return {
    ...rest,
    blockIds: parseBlockIds(blockIdsJson),
    error: parseTranslationError(error),
  };
}

function toTranslationProjectionSpanRecord(
  row: TranslationProjectionSpanRow,
): TranslationProjectionSpan {
  return row;
}

function serializeBlockIds(blockIds: string[]): string {
  return JSON.stringify(blockIds);
}

function parseBlockIds(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (
    Array.isArray(parsed) &&
    parsed.every((item) => typeof item === "string")
  ) {
    return parsed;
  }

  throw new MemoryRepositoryError("Invalid translation block ids.");
}

function serializeTranslationError(
  error: TranslationPersistedError | null | undefined,
): string | null | undefined {
  if (error === undefined || error === null) {
    return error;
  }

  return JSON.stringify(error);
}

function parseTranslationError(
  value: string | null,
): TranslationPersistedError | null {
  if (value === null) {
    return null;
  }

  const parsed: unknown = JSON.parse(value);
  if (!isTranslationPersistedError(parsed)) {
    throw new MemoryRepositoryError("Invalid persisted translation error.");
  }
  return parsed;
}

function isTranslationPersistedError(
  value: unknown,
): value is TranslationPersistedError {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.code === "string" &&
    typeof record.message === "string" &&
    (record.action === undefined || typeof record.action === "string") &&
    (record.reason === undefined || typeof record.reason === "string") &&
    (
      record.diagnostics === undefined ||
      (
        Array.isArray(record.diagnostics) &&
        record.diagnostics.every(isTranslationValidationDiagnostic)
      )
    )
  );
}

function isTranslationValidationDiagnostic(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    hasOnlyKeys(record, TRANSLATION_VALIDATION_DIAGNOSTIC_KEYS) &&
    isTranslationValidationDiagnosticKind(record.kind) &&
    typeof record.message === "string" &&
    isSafeDiagnosticText(record.message) &&
    (record.chunkIndex === undefined || Number.isSafeInteger(record.chunkIndex)) &&
    (record.segmentId === undefined || typeof record.segmentId === "string") &&
    (record.blockId === undefined || typeof record.blockId === "string") &&
    isOptionalDiagnosticEntry(record.sourceEntry) &&
    isOptionalDiagnosticEntry(record.translatedEntry) &&
    isOptionalDiagnosticEntry(record.protectedSpan)
  );
}

function isOptionalDiagnosticEntry(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    hasOnlyKeys(record, TRANSLATION_DIAGNOSTIC_ENTRY_KEYS) &&
    typeof record.kind === "string" &&
    isSafeDiagnosticText(record.kind) &&
    typeof record.valuePreview === "string" &&
    isSafeDiagnosticText(record.valuePreview)
  );
}

function isSafeDiagnosticText(value: string): boolean {
  return value.length <= 512 && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value);
}

const TRANSLATION_VALIDATION_DIAGNOSTIC_KEYS = new Set([
  "kind",
  "message",
  "chunkIndex",
  "segmentId",
  "blockId",
  "sourceEntry",
  "translatedEntry",
  "protectedSpan",
]);

const TRANSLATION_DIAGNOSTIC_ENTRY_KEYS = new Set([
  "kind",
  "valuePreview",
]);

function hasOnlyKeys(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): boolean {
  return Object.keys(record).every((key) => allowedKeys.has(key));
}

function isTranslationValidationDiagnosticKind(
  value: unknown,
): value is TranslationValidationDiagnostic["kind"] {
  return value === "markdown_structure" ||
    value === "protected_span" ||
    value === "segment_schema" ||
    value === "segment_length_ratio" ||
    value === "projection";
}

function createEmptyTranslationChunkCounts(): Record<TranslationChunkStatus, number> {
  return Object.fromEntries(
    TRANSLATION_CHUNK_STATUSES.map((status) => [status, 0]),
  ) as Record<TranslationChunkStatus, number>;
}

async function requireTagByName(db: TraumaDatabase, name: string): Promise<Tag> {
  const tag = await findTagByName(db, name);
  if (tag === undefined) {
    throw new MemoryRepositoryError(`Cannot find tag after create: ${name}`);
  }
  return tag;
}

async function requireCategoryByName(
  db: TraumaDatabase,
  name: string,
): Promise<Category> {
  const category = await findCategoryByName(db, name);
  if (category === undefined) {
    throw new MemoryRepositoryError(`Cannot find category after create: ${name}`);
  }
  return category;
}

async function findTagByName(
  db: TraumaDatabase,
  name: string,
): Promise<Tag | undefined> {
  const exactName = normalizeTaxonomyLookupName(name);
  return (
    (await db.query.tags.findFirst({
      where: eq(schema.tags.name, exactName),
    })) ??
    (await db.query.tags.findFirst({
      where: taxonomyNameEquals(schema.tags.name, exactName),
    }))
  );
}

async function findCategoryByName(
  db: TraumaDatabase,
  name: string,
): Promise<Category | undefined> {
  const exactName = normalizeTaxonomyLookupName(name);
  return (
    (await db.query.categories.findFirst({
      where: eq(schema.categories.name, exactName),
    })) ??
    (await db.query.categories.findFirst({
      where: taxonomyNameEquals(schema.categories.name, exactName),
    }))
  );
}

function taxonomyNameEquals(
  column: typeof schema.tags.name | typeof schema.categories.name,
  name: string,
) {
  const normalizedName = normalizeTaxonomyLookupName(name);
  return or(
    eq(column, normalizedName),
    sql`lower(${column}) = ${foldAsciiTaxonomyLookupName(normalizedName)}`,
  );
}

function normalizeTaxonomyLookupName(name: string): string {
  return name.trim();
}

function foldAsciiTaxonomyLookupName(name: string): string {
  return name.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

async function assertMemoryExists(
  db: TraumaDatabase,
  memoryId: string,
  action:
    | "attach category to"
    | "attach tag to"
    | "create translation for"
    | "create moment for"
    | "detach tag from",
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

async function requireTagById(
  db: TraumaDatabase,
  tagId: string,
): Promise<Tag> {
  const tag = await db.query.tags.findFirst({
    where: eq(schema.tags.id, tagId),
  });
  if (tag === undefined) {
    throw new MemoryRepositoryError(`Cannot attach missing tag: ${tagId}`);
  }

  return tag;
}

async function findAttachedTagByName(
  db: TraumaDatabase,
  memoryId: string,
  name: string,
): Promise<Tag | undefined> {
  const exactName = normalizeTaxonomyLookupName(name);
  const exact = db
    .select({
      id: schema.tags.id,
      name: schema.tags.name,
      createdAt: schema.tags.createdAt,
      updatedAt: schema.tags.updatedAt,
    })
    .from(schema.tags)
    .innerJoin(schema.memoryTags, eq(schema.tags.id, schema.memoryTags.tagId))
    .where(
      and(
        eq(schema.memoryTags.memoryId, memoryId),
        eq(schema.tags.name, exactName),
      ),
    )
    .get();
  if (exact !== undefined) {
    return exact;
  }

  return db
    .select({
      id: schema.tags.id,
      name: schema.tags.name,
      createdAt: schema.tags.createdAt,
      updatedAt: schema.tags.updatedAt,
    })
    .from(schema.tags)
    .innerJoin(schema.memoryTags, eq(schema.tags.id, schema.memoryTags.tagId))
    .where(
      and(
        eq(schema.memoryTags.memoryId, memoryId),
        taxonomyNameEquals(schema.tags.name, name),
      ),
    )
    .get();
}

function requireValidTagName(name: string): string {
  const validation = validateTagName(name);
  if (!validation.ok) {
    throw new MemoryRepositoryError(validation.error);
  }

  return validation.name;
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

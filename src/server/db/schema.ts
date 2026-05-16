import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { BACKUP_STATUSES, type BackupStatus } from "../backup/status";
import { EXTRACTION_STATUSES, type ExtractionStatus } from "../memory-status";
import {
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  SUPPORTED_TRANSLATION_LANGUAGES,
  type SupportedLanguageCode,
} from "../../settings/languages";

export type { BackupStatus } from "../backup/status";

const extractionStatusSqlList = sql.raw(
  EXTRACTION_STATUSES.map(toSqlStringLiteral).join(", "),
);
const backupStatusSqlList = sql.raw(
  BACKUP_STATUSES.map(toSqlStringLiteral).join(", "),
);
const backupFailsafeAlertKindSqlList = sql.raw(
  [
    "backup_path_drift",
    "backup_content_inconsistent",
    "backup_repository_missing",
    "backup_push_failed",
  ].map(toSqlStringLiteral).join(", "),
);
const backupFailsafeSeveritySqlList = sql.raw(
  ["critical"].map(toSqlStringLiteral).join(", "),
);
const supportedLanguageSqlList = sql.raw(
  SUPPORTED_TRANSLATION_LANGUAGES.map((language) =>
    toSqlStringLiteral(language.code),
  ).join(", "),
);

function toSqlStringLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function timestamps() {
  return {
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  };
}

export const memories = sqliteTable(
  "memories",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    faviconUrl: text("favicon_url"),
    contentPath: text("content_path").notNull(),
    extractionStatus: text("extraction_status")
      .$type<ExtractionStatus>()
      .notNull(),
    extractionError: text("extraction_error"),
    read: integer("read", { mode: "boolean" }).notNull().default(false),
    backupStatus: text("backup_status").$type<BackupStatus>().notNull(),
    lastBackupAt: integer("last_backup_at", { mode: "timestamp_ms" }),
    lastBackupError: text("last_backup_error"),
    ...timestamps(),
  },
  (table) => [
    index("memories_url_idx").on(table.url),
    index("memories_created_at_idx").on(table.createdAt),
    index("memories_extraction_status_idx").on(table.extractionStatus),
    index("memories_backup_status_idx").on(table.backupStatus),
    check(
      "memories_extraction_status_check",
      sql`${table.extractionStatus} in (${extractionStatusSqlList})`,
    ),
    check(
      "memories_backup_status_check",
      sql`${table.backupStatus} in (${backupStatusSqlList})`,
    ),
  ],
);

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    ...timestamps(),
  },
  (table) => [uniqueIndex("tags_name_unique").on(table.name)],
);

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    ...timestamps(),
  },
  (table) => [uniqueIndex("categories_name_unique").on(table.name)],
);

export const memoryTags = sqliteTable(
  "memory_tags",
  {
    memoryId: text("memory_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.memoryId, table.tagId] }),
    index("memory_tags_tag_id_idx").on(table.tagId),
  ],
);

export const memoryCategories = sqliteTable(
  "memory_categories",
  {
    memoryId: text("memory_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.memoryId, table.categoryId] }),
    index("memory_categories_category_id_idx").on(table.categoryId),
  ],
);

export const flashbacks = sqliteTable(
  "flashbacks",
  {
    id: text("id").primaryKey(),
    memoryId: text("memory_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    prefix: text("prefix").notNull(),
    suffix: text("suffix").notNull(),
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    contentHash: text("content_hash"),
    ...timestamps(),
  },
  (table) => [
    index("flashbacks_memory_id_idx").on(table.memoryId),
    index("flashbacks_created_at_idx").on(table.createdAt),
    check("flashbacks_start_offset_check", sql`${table.startOffset} >= 0`),
    check("flashbacks_end_offset_check", sql`${table.endOffset} > ${table.startOffset}`),
  ],
);

export const moments = sqliteTable(
  "moments",
  {
    id: text("id").primaryKey(),
    memoryId: text("memory_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),
    sectionAnchor: text("section_anchor").notNull(),
    sectionTitle: text("section_title").notNull(),
    sectionLevel: integer("section_level").notNull(),
    sectionPath: text("section_path").notNull(),
    sectionStartOffset: integer("section_start_offset"),
    sectionEndOffset: integer("section_end_offset"),
    contentHash: text("content_hash"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("moments_memory_section_anchor_unique").on(
      table.memoryId,
      table.sectionAnchor,
    ),
    index("moments_memory_id_idx").on(table.memoryId),
    index("moments_created_at_idx").on(table.createdAt),
    check(
      "moments_section_anchor_check",
      sql`length(${table.sectionAnchor}) > 0`,
    ),
    check(
      "moments_section_title_check",
      sql`length(${table.sectionTitle}) > 0`,
    ),
    check(
      "moments_section_level_check",
      sql`${table.sectionLevel} >= 1 and ${table.sectionLevel} <= 6`,
    ),
    check(
      "moments_section_offset_check",
      sql`(${table.sectionStartOffset} is null and ${table.sectionEndOffset} is null) or (${table.sectionStartOffset} is not null and ${table.sectionEndOffset} is not null and ${table.sectionStartOffset} >= 0 and ${table.sectionEndOffset} > ${table.sectionStartOffset})`,
    ),
  ],
);

export const backupEnvironmentStamps = sqliteTable(
  "backup_environment_stamps",
  {
    id: text("id").primaryKey(),
    projectPath: text("project_path").notNull(),
    storePath: text("store_path").notNull(),
    gitRemote: text("git_remote").notNull(),
    gitRemoteUrl: text("git_remote_url"),
    gitBranch: text("git_branch").notNull(),
    ...timestamps(),
  },
  (table) => [
    check("backup_environment_stamps_id_check", sql`${table.id} = 'default'`),
  ],
);

export const backupFailsafeAlerts = sqliteTable(
  "backup_failsafe_alerts",
  {
    id: text("id").primaryKey(),
    kind: text("kind")
      .$type<
        | "backup_path_drift"
        | "backup_content_inconsistent"
        | "backup_repository_missing"
        | "backup_push_failed"
      >()
      .notNull(),
    severity: text("severity").$type<"critical">().notNull(),
    message: text("message").notNull(),
    previousProjectPath: text("previous_project_path"),
    previousStorePath: text("previous_store_path"),
    currentProjectPath: text("current_project_path").notNull(),
    currentStorePath: text("current_store_path").notNull(),
    gitRemote: text("git_remote").notNull(),
    gitRemoteUrl: text("git_remote_url"),
    gitBranch: text("git_branch").notNull(),
    error: text("error"),
    ...timestamps(),
  },
  (table) => [
    check("backup_failsafe_alerts_id_check", sql`${table.id} = 'active'`),
    check(
      "backup_failsafe_alerts_kind_check",
      sql`${table.kind} in (${backupFailsafeAlertKindSqlList})`,
    ),
    check(
      "backup_failsafe_alerts_severity_check",
      sql`${table.severity} in (${backupFailsafeSeveritySqlList})`,
    ),
  ],
);

export const appSettings = sqliteTable(
  "app_settings",
  {
    id: text("id").primaryKey(),
    translationTargetLanguage: text("translation_target_language")
      .$type<SupportedLanguageCode>()
      .notNull()
      .default(DEFAULT_TRANSLATION_TARGET_LANGUAGE),
    ...timestamps(),
  },
  (table) => [
    check("app_settings_id_check", sql`${table.id} = 'default'`),
    check(
      "app_settings_translation_target_language_check",
      sql`${table.translationTargetLanguage} in (${supportedLanguageSqlList})`,
    ),
  ],
);

export const openaiAuthCredentials = sqliteTable(
  "openai_auth_credentials",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    credentialReference: text("credential_reference").notNull(),
    ...timestamps(),
  },
  (table) => [
    check("openai_auth_credentials_id_check", sql`${table.id} = 'default'`),
  ],
);

export const memoriesRelations = relations(memories, ({ many }) => ({
  flashbacks: many(flashbacks),
  memoryCategories: many(memoryCategories),
  memoryTags: many(memoryTags),
  moments: many(moments),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  memoryTags: many(memoryTags),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  memoryCategories: many(memoryCategories),
}));

export const memoryTagsRelations = relations(memoryTags, ({ one }) => ({
  memory: one(memories, {
    fields: [memoryTags.memoryId],
    references: [memories.id],
  }),
  tag: one(tags, {
    fields: [memoryTags.tagId],
    references: [tags.id],
  }),
}));

export const memoryCategoriesRelations = relations(
  memoryCategories,
  ({ one }) => ({
    category: one(categories, {
      fields: [memoryCategories.categoryId],
      references: [categories.id],
    }),
    memory: one(memories, {
      fields: [memoryCategories.memoryId],
      references: [memories.id],
    }),
  }),
);

export const flashbacksRelations = relations(flashbacks, ({ one }) => ({
  memory: one(memories, {
    fields: [flashbacks.memoryId],
    references: [memories.id],
  }),
}));

export const momentsRelations = relations(moments, ({ one }) => ({
  memory: one(memories, {
    fields: [moments.memoryId],
    references: [memories.id],
  }),
}));

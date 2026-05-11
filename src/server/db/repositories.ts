import { asc, desc, eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import * as schema from "./schema";

export type TraumaDatabase = BunSQLiteDatabase<typeof schema>;
type Memory = typeof schema.memories.$inferSelect;
type Highlight = typeof schema.highlights.$inferSelect;
type MemoryBackupStatusUpdate = Pick<
  Memory,
  "id" | "backupStatus" | "lastBackupAt" | "lastBackupError" | "updatedAt"
>;

export interface MemoryBrowseRow {
  id: string;
  title: string;
  url: string;
  description: string;
  capturedAt: string;
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
  create: (input: Memory) => Promise<Memory>;
  updateBackupStatus: (input: {
    id: string;
    backupStatus: schema.BackupStatus;
    lastBackupAt?: Date | null;
    lastBackupError?: string | null;
    updatedAt: Date;
  }) => Promise<MemoryBackupStatusUpdate>;
  listForBrowse: () => Promise<MemoryBrowseRow[]>;
}

export interface HighlightRepository {
  listForMemory: (memoryId: string) => Promise<Highlight[]>;
  replaceForMemory: (memoryId: string, highlights: Highlight[]) => Promise<Highlight[]>;
  listForBrowse: () => Promise<HighlightBrowseRow[]>;
}

export interface TraumaRepositories {
  memories: MemoryRepository;
  highlights: HighlightRepository;
}

export class MemoryRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryRepositoryError";
  }
}

export function createRepositories(db: TraumaDatabase): TraumaRepositories {
  return {
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
        return input;
      },
      updateBackupStatus: async (input) => {
        const updated = await db
          .update(schema.memories)
          .set({
            backupStatus: input.backupStatus,
            lastBackupAt: input.lastBackupAt,
            lastBackupError: input.lastBackupError,
            updatedAt: input.updatedAt,
          })
          .where(eq(schema.memories.id, input.id))
          .returning({ id: schema.memories.id })
          .get();
        if (updated === undefined) {
          throw new MemoryRepositoryError(
            `Cannot update backup status for missing memory: ${input.id}`,
          );
        }
        return {
          id: input.id,
          backupStatus: input.backupStatus,
          lastBackupAt: input.lastBackupAt ?? null,
          lastBackupError: input.lastBackupError ?? null,
          updatedAt: input.updatedAt,
        };
      },
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

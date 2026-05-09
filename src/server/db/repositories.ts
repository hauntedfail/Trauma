import { desc, eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import * as schema from "./schema";

export type TraumaDatabase = BunSQLiteDatabase<typeof schema>;
type Memory = typeof schema.memories.$inferSelect;

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

export interface MemoryRepository {
  findById: (id: string) => Promise<Memory | undefined>;
  create: (input: Memory) => Promise<Memory>;
  updateBackupStatus: (input: {
    id: string;
    backupStatus: schema.BackupStatus;
    lastBackupAt?: Date | null;
    lastBackupError?: string | null;
    updatedAt: Date;
  }) => Promise<Memory>;
  listForBrowse: () => Promise<MemoryBrowseRow[]>;
}

export interface TraumaRepositories {
  memories: MemoryRepository;
}

export function createRepositories(db: TraumaDatabase): TraumaRepositories {
  return {
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
        await db
          .update(schema.memories)
          .set({
            backupStatus: input.backupStatus,
            lastBackupAt: input.lastBackupAt,
            lastBackupError: input.lastBackupError,
            updatedAt: input.updatedAt,
          })
          .where(eq(schema.memories.id, input.id))
          .run();
        const memory = await db.query.memories.findFirst({
          where: eq(schema.memories.id, input.id),
        });
        if (!memory) {
          throw new Error(`memory ${input.id} was not found`);
        }

        return memory;
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

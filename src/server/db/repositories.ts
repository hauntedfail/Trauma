import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import * as schema from "./schema";

export type TraumaDatabase = BunSQLiteDatabase<typeof schema>;
type Memory = typeof schema.memories.$inferSelect;

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
    },
  };
}

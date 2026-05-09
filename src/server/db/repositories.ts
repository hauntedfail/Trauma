import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import * as schema from "./schema";

export type TraumaDatabase = BunSQLiteDatabase<typeof schema>;

export interface MemoryRepository {
  findById: (id: string) => Promise<typeof schema.memories.$inferSelect | undefined>;
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
    },
  };
}

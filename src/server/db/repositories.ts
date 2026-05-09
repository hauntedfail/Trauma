import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import * as schema from "./schema";

export type TraumaDatabase = BunSQLiteDatabase<typeof schema>;

export interface MemoryRepository {
  findById: (id: string) => Promise<typeof schema.memories.$inferSelect | undefined>;
  create: (
    input: typeof schema.memories.$inferInsert,
  ) => Promise<typeof schema.memories.$inferSelect>;
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
        const memory = await db.query.memories.findFirst({
          where: eq(schema.memories.id, input.id),
        });
        if (!memory) {
          throw new Error(`created memory ${input.id} was not found`);
        }

        return memory;
      },
    },
  };
}

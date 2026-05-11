import {
  categories,
  highlights,
  memories,
  memoryCategories,
  memoryTags,
  tags,
} from "./schema";

export { initializeDatabase } from "./connection";
export { createRepositories, MemoryRepositoryError } from "./repositories";
export type {
  TraumaDatabaseConnection,
} from "./connection";
export type {
  MemoryRepository,
  TraumaDatabase,
  TraumaRepositories,
} from "./repositories";
export * from "./schema";

export const schema = {
  categories,
  highlights,
  memories,
  memoryCategories,
  memoryTags,
  tags,
};

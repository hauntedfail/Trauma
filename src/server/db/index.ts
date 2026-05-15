import {
  appSettings,
  backupEnvironmentStamps,
  backupFailsafeAlerts,
  categories,
  flashbacks,
  highlights,
  memories,
  memoryCategories,
  memoryTags,
  openaiAuthCredentials,
  tags,
} from "./schema";

export { initializeDatabase } from "./connection";
export { createRepositories, MemoryRepositoryError } from "./repositories";
export type {
  TraumaDatabaseConnection,
} from "./connection";
export type {
  BackupEnvironmentRepository,
  BackupEnvironmentStamp,
  BackupFailsafeAlert,
  FlashbackRepository,
  HighlightRepository,
  MemoryRepository,
  TraumaDatabase,
  TraumaRepositories,
} from "./repositories";
export * from "./schema";

export const schema = {
  appSettings,
  backupEnvironmentStamps,
  backupFailsafeAlerts,
  categories,
  flashbacks,
  highlights,
  memories,
  memoryCategories,
  memoryTags,
  openaiAuthCredentials,
  tags,
};

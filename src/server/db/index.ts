import {
  appSettings,
  backupEnvironmentStamps,
  backupFailsafeAlerts,
  categories,
  flashbacks,
  memories,
  memoryCategories,
  memoryTags,
  moments,
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
  MemoryRepository,
  MomentRepository,
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
  memories,
  memoryCategories,
  memoryTags,
  moments,
  openaiAuthCredentials,
  tags,
};

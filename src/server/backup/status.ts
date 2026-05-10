export const BACKUP_STATUSES = [
  "pending",
  "queued",
  "success",
  "failed",
  "disabled",
] as const;

export type BackupStatus = (typeof BACKUP_STATUSES)[number];

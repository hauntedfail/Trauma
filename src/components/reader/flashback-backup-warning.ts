export interface FlashbackBackupWarning {
  code: "backup_enqueue_failed";
  message: string;
  status: "failed" | "pending";
}

export function readFlashbackBackupWarning(
  value: unknown,
): FlashbackBackupWarning | undefined {
  if (!isRecord(value) || !isRecord(value.result)) {
    return undefined;
  }
  const backup = value.result.backup;
  if (!isRecord(backup) || !isRecord(backup.warning)) {
    return undefined;
  }
  if (backup.status !== "failed" && backup.status !== "pending") {
    return undefined;
  }
  if (
    backup.warning.code !== "backup_enqueue_failed" ||
    typeof backup.warning.message !== "string" ||
    backup.warning.message.trim() === ""
  ) {
    return undefined;
  }
  return {
    code: "backup_enqueue_failed",
    message: backup.warning.message,
    status: backup.status,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { createHash } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import type { BackupFailsafeAlert } from "../db/repositories";
import * as schema from "../db/schema";

export function sameBackupFailsafeAlertGeneration(
  left: BackupFailsafeAlert,
  right: BackupFailsafeAlert,
) {
  return serializeBackupFailsafeAlertGeneration(left) ===
    serializeBackupFailsafeAlertGeneration(right);
}

/**
 * Opaque approval token for one immutable alert generation. The token exposes
 * none of the operator paths, remote fingerprints, or diagnostics it binds.
 */
export function getBackupFailsafeAlertGeneration(
  alert: BackupFailsafeAlert,
) {
  return createHash("sha256")
    .update(serializeBackupFailsafeAlertGeneration(alert))
    .digest("hex");
}

export function backupFailsafeAlertGenerationWhere(
  alert: BackupFailsafeAlert,
) {
  return and(
    eq(schema.backupFailsafeAlerts.id, alert.id),
    eq(schema.backupFailsafeAlerts.kind, alert.kind),
    eq(schema.backupFailsafeAlerts.severity, alert.severity),
    eq(schema.backupFailsafeAlerts.message, alert.message),
    nullableTextEquals(
      schema.backupFailsafeAlerts.previousProjectPath,
      alert.previousProjectPath,
    ),
    nullableTextEquals(
      schema.backupFailsafeAlerts.previousStorePath,
      alert.previousStorePath,
    ),
    eq(
      schema.backupFailsafeAlerts.currentProjectPath,
      alert.currentProjectPath,
    ),
    eq(schema.backupFailsafeAlerts.currentStorePath, alert.currentStorePath),
    eq(schema.backupFailsafeAlerts.gitRemote, alert.gitRemote),
    nullableTextEquals(
      schema.backupFailsafeAlerts.gitRemoteUrl,
      alert.gitRemoteUrl,
    ),
    eq(schema.backupFailsafeAlerts.gitBranch, alert.gitBranch),
    nullableTextEquals(schema.backupFailsafeAlerts.error, alert.error),
    eq(schema.backupFailsafeAlerts.createdAt, alert.createdAt),
    eq(schema.backupFailsafeAlerts.updatedAt, alert.updatedAt),
  );
}

function serializeBackupFailsafeAlertGeneration(alert: BackupFailsafeAlert) {
  return JSON.stringify([
    alert.id,
    alert.kind,
    alert.severity,
    alert.message,
    alert.previousProjectPath,
    alert.previousStorePath,
    alert.currentProjectPath,
    alert.currentStorePath,
    alert.gitRemote,
    alert.gitRemoteUrl,
    alert.gitBranch,
    alert.error,
    alert.createdAt.getTime(),
    alert.updatedAt.getTime(),
  ]);
}

function nullableTextEquals(
  column:
    | typeof schema.backupFailsafeAlerts.previousProjectPath
    | typeof schema.backupFailsafeAlerts.previousStorePath
    | typeof schema.backupFailsafeAlerts.gitRemoteUrl
    | typeof schema.backupFailsafeAlerts.error,
  value: string | null,
) {
  return value === null ? isNull(column) : eq(column, value);
}

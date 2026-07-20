import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";

import {
  resolveRuntimeLeaseCoordinatorPath,
  resolveRuntimeProcessLeasePaths,
} from "../../../src/server/runtime/process-lease";

export interface TestCoordinatorRow {
  display_resources: string;
  guard_path: string;
  lease_id: string;
  owner_pid: number;
  owner_token: string;
  purpose: "migration" | "runtime";
  root_set: string;
  started_at: string;
}

export async function createBoundGuard(leaseId: string, ownerToken: string) {
  const path = join(
    dirname(resolveRuntimeLeaseCoordinatorPath()),
    "guards",
    `${leaseId}.sqlite`,
  );
  await writeFile(path, "", { mode: 0o600 });
  const database = new Database(path, { create: false, readwrite: true });
  database.run(
    "CREATE TABLE lease_guard (id INTEGER PRIMARY KEY, lease_id TEXT, owner_token TEXT)",
  );
  database
    .query("INSERT INTO lease_guard VALUES (1, ?1, ?2)")
    .run(leaseId, ownerToken);
  database.close();
  return path;
}

export function insertCoordinatorRow(
  plan: ReturnType<typeof resolveRuntimeProcessLeasePaths>,
  leaseId: string,
  ownerToken: string,
  guardPath: string,
  purpose: "migration" | "runtime" = "runtime",
) {
  const database = new Database(resolveRuntimeLeaseCoordinatorPath());
  database
    .query(
      `INSERT INTO coordinator_leases (
        lease_id, owner_token, purpose, guard_path, root_set,
        display_resources, owner_pid, started_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .run(
      leaseId,
      ownerToken,
      purpose,
      guardPath,
      plan.identity,
      JSON.stringify(
        plan.resources.map((resource) => ({
          resourceLabels: resource.resourceLabels,
          resourcePath: resource.resourcePath,
        })),
      ),
      process.pid,
      new Date().toISOString(),
    );
  database.close();
}

export function deleteCoordinatorRow(leaseId: string) {
  const database = new Database(resolveRuntimeLeaseCoordinatorPath());
  database
    .query("DELETE FROM coordinator_leases WHERE lease_id = ?1")
    .run(leaseId);
  database.close();
}

export function readCoordinatorRow(
  purpose: "migration" | "runtime",
): TestCoordinatorRow | undefined {
  const database = new Database(resolveRuntimeLeaseCoordinatorPath());
  try {
    return database
      .query<TestCoordinatorRow, [string]>(
        `SELECT lease_id, owner_token, purpose, guard_path, root_set,
          display_resources, owner_pid, started_at
         FROM coordinator_leases WHERE purpose = ?1`,
      )
      .get(purpose) ?? undefined;
  } finally {
    database.close();
  }
}

export function insertRawCoordinatorRow(row: TestCoordinatorRow): void {
  const database = new Database(resolveRuntimeLeaseCoordinatorPath());
  try {
    database
      .query(
        `INSERT INTO coordinator_leases (
          lease_id, owner_token, purpose, guard_path, root_set,
          display_resources, owner_pid, started_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .run(
        row.lease_id,
        row.owner_token,
        row.purpose,
        row.guard_path,
        row.root_set,
        row.display_resources,
        row.owner_pid,
        row.started_at,
      );
  } finally {
    database.close();
  }
}

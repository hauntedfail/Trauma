import type { Database as BunDatabase } from "bun:sqlite";

import type { RuntimeLeasePlan } from "./runtime-lease-types";

export type CoordinatorLeasePurpose = "migration" | "runtime";

export interface CoordinatorLeaseRow {
  display_resources: string;
  guard_path: string;
  lease_id: string;
  owner_pid: number;
  owner_token: string;
  purpose: CoordinatorLeasePurpose;
  root_set: string;
  started_at: string;
}

export interface PrivateFileIdentity {
  dev: bigint;
  ino: bigint;
}

export interface HeldGuard {
  database: BunDatabase;
  identity: PrivateFileIdentity;
  path: string;
  release: () => void;
}

export interface CoordinatorOwner {
  guard: HeldGuard;
  leaseId: string;
  ownerToken: string;
  pid: number;
  startedAt: string;
}

export interface CoordinatorLeaseState {
  coordinatorRowReleased: boolean;
  owner: CoordinatorOwner;
  plan: RuntimeLeasePlan;
  purpose: CoordinatorLeasePurpose;
  row: CoordinatorLeaseRow;
}

export interface GuardProbe {
  identity?: PrivateFileIdentity;
  row: CoordinatorLeaseRow;
  status: "live" | "stale";
}

export interface GuardPathProbe {
  identity?: PrivateFileIdentity;
  status: "live" | "stale";
}

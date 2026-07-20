export interface CanonicalPathIdentity {
  readonly anchor: string;
  readonly suffix: readonly string[];
}

export interface RuntimeResourceLeaseInput {
  readonly resourceLabel: string;
  readonly resourcePath: string;
}

export interface RuntimeProcessLeaseResource {
  readonly identities: readonly CanonicalPathIdentity[];
  readonly resourceLabels: readonly string[];
  readonly resourcePath: string;
}

export interface RuntimeLeasePlan {
  readonly identity: string;
  readonly resources: RuntimeProcessLeaseResource[];
  readonly rootSet: string;
}

export interface ProcessLease {
  readonly identity: string;
  readonly resources: readonly RuntimeProcessLeaseResource[];
  release: () => void;
}

export interface RuntimeProcessLease extends ProcessLease {
  admits: (resources: readonly RuntimeResourceLeaseInput[]) => boolean;
  assertCovers: (resources: readonly RuntimeResourceLeaseInput[]) => void;
  borrow: (
    resources: readonly RuntimeResourceLeaseInput[],
  ) => RuntimeProcessLeaseBorrow;
  expand: (resources: readonly RuntimeResourceLeaseInput[]) => void;
  reserves: (resources: readonly RuntimeResourceLeaseInput[]) => boolean;
  suspendIfIdle: (
    resources: readonly RuntimeResourceLeaseInput[],
  ) => boolean;
}

export interface RuntimeProcessLeaseBorrow {
  assertCovers: (resources: readonly RuntimeResourceLeaseInput[]) => void;
  release: () => void;
}

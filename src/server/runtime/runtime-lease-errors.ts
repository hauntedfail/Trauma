export class RuntimeProcessLeaseError extends Error {
  readonly code = "TRAUMA_RUNTIME_ALREADY_ACTIVE";

  constructor(message: string) {
    super(message);
    this.name = "RuntimeProcessLeaseError";
  }
}

export class RuntimeProcessLeaseCoverageError extends Error {
  readonly code = "TRAUMA_RUNTIME_CONFIG_CHANGED";

  constructor(message: string) {
    super(message);
    this.name = "RuntimeProcessLeaseCoverageError";
  }
}

export class RuntimeStorageBusyError extends Error {
  readonly code = "TRAUMA_RUNTIME_STORAGE_BUSY";

  constructor(message: string) {
    super(message);
    this.name = "RuntimeStorageBusyError";
  }
}

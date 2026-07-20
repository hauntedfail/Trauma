import { resolve } from "node:path";

type LeaseKind = "mutation" | "recovery";
type ReleaseLease = () => void;

interface LeaseWaiter {
  kind: LeaseKind;
  resolve: (release: ReleaseLease) => void;
}

interface StoreOperationState {
  activeMutations: number;
  recoveryActive: boolean;
  waiters: LeaseWaiter[];
}

const operationStates = new Map<string, StoreOperationState>();

export async function withMemoryOperationMutationLease<T>(
  storePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireMemoryOperationMutationLease(storePath);
  try {
    return await operation();
  } finally {
    release();
  }
}

export async function withMemoryOperationRecoveryLease<T>(
  storePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireLease(storePath, "recovery");
  try {
    return await operation();
  } finally {
    release();
  }
}

export function acquireMemoryOperationMutationLease(
  storePath: string,
): Promise<ReleaseLease> {
  return acquireLease(storePath, "mutation");
}

function acquireLease(
  storePath: string,
  kind: LeaseKind,
): Promise<ReleaseLease> {
  const key = resolve(storePath);
  const state = getOperationState(key);

  if (
    kind === "mutation" &&
    !state.recoveryActive &&
    state.waiters.length === 0
  ) {
    state.activeMutations += 1;
    return Promise.resolve(createRelease(key, state, kind));
  }
  if (
    kind === "recovery" &&
    !state.recoveryActive &&
    state.activeMutations === 0 &&
    state.waiters.length === 0
  ) {
    state.recoveryActive = true;
    return Promise.resolve(createRelease(key, state, kind));
  }

  return new Promise<ReleaseLease>((resolveWaiter) => {
    state.waiters.push({ kind, resolve: resolveWaiter });
    drainWaiters(key, state);
  });
}

function getOperationState(key: string): StoreOperationState {
  let state = operationStates.get(key);
  if (state === undefined) {
    state = {
      activeMutations: 0,
      recoveryActive: false,
      waiters: [],
    };
    operationStates.set(key, state);
  }
  return state;
}

function createRelease(
  key: string,
  state: StoreOperationState,
  kind: LeaseKind,
): ReleaseLease {
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;

    if (kind === "mutation") {
      state.activeMutations -= 1;
    } else {
      state.recoveryActive = false;
    }
    drainWaiters(key, state);
    cleanupOperationState(key, state);
  };
}

function drainWaiters(key: string, state: StoreOperationState): void {
  if (state.recoveryActive || state.activeMutations > 0) {
    return;
  }

  const first = state.waiters[0];
  if (first === undefined) {
    cleanupOperationState(key, state);
    return;
  }
  if (first.kind === "recovery") {
    state.waiters.shift();
    state.recoveryActive = true;
    first.resolve(createRelease(key, state, "recovery"));
    return;
  }

  while (state.waiters[0]?.kind === "mutation") {
    const waiter = state.waiters.shift();
    if (waiter === undefined) {
      break;
    }
    state.activeMutations += 1;
    waiter.resolve(createRelease(key, state, "mutation"));
  }
}

function cleanupOperationState(
  key: string,
  state: StoreOperationState,
): void {
  if (
    state.activeMutations === 0 &&
    !state.recoveryActive &&
    state.waiters.length === 0 &&
    operationStates.get(key) === state
  ) {
    operationStates.delete(key);
  }
}

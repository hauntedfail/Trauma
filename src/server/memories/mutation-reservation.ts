import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "node:path";

interface MutationState {
  activeWriters: number;
  deletionReserved: boolean;
  idleWaiters: Set<() => void>;
}

export interface MemoryArtifactMutationReservation {
  assertWritable: () => void;
}

export interface MemoryDeletionReservation {
  assertExclusive: () => void;
}

interface ActiveArtifactReservation extends MemoryArtifactMutationReservation {
  active: boolean;
}

const mutationStates = new Map<string, MutationState>();
const activeArtifactReservations = new AsyncLocalStorage<
  ReadonlyMap<string, ActiveArtifactReservation>
>();

export class MemoryDeletionReservedError extends Error {
  constructor() {
    super("Memory deletion is in progress.");
    this.name = "MemoryDeletionReservedError";
  }
}

export async function withMemoryArtifactMutation<T>(
  input: { memoryId: string; storePath: string },
  operation: (reservation: MemoryArtifactMutationReservation) => Promise<T>,
): Promise<T> {
  const key = mutationKey(input);
  const inherited = activeArtifactReservations.getStore()?.get(key);
  if (inherited !== undefined) {
    inherited.assertWritable();
    return operation(inherited);
  }

  const state = getMutationState(key);
  if (state.deletionReserved) {
    throw new MemoryDeletionReservedError();
  }

  state.activeWriters += 1;
  const reservation: ActiveArtifactReservation = {
    active: true,
    assertWritable: () => {
      if (!reservation.active) {
        throw new Error("Memory artifact mutation reservation is no longer active.");
      }
    },
  };
  const context = new Map(activeArtifactReservations.getStore() ?? []);
  context.set(key, reservation);

  try {
    return await activeArtifactReservations.run(
      context,
      () => operation(reservation),
    );
  } finally {
    reservation.active = false;
    state.activeWriters -= 1;
    if (state.activeWriters === 0) {
      for (const resolveWaiter of state.idleWaiters) {
        resolveWaiter();
      }
      state.idleWaiters.clear();
      cleanupMutationState(key, state);
    }
  }
}

export async function withMemoryDeletionReservation<T>(
  input: { memoryId: string; storePath: string },
  operation: (reservation: MemoryDeletionReservation) => Promise<T>,
): Promise<T> {
  const key = mutationKey(input);
  if (activeArtifactReservations.getStore()?.has(key)) {
    throw new Error("Cannot reserve deletion from an active artifact mutation.");
  }
  const state = getMutationState(key);
  if (state.deletionReserved) {
    throw new MemoryDeletionReservedError();
  }
  state.deletionReserved = true;

  let active = true;
  const reservation: MemoryDeletionReservation = {
    assertExclusive: () => {
      if (!active || !state.deletionReserved || state.activeWriters !== 0) {
        throw new Error("Memory deletion reservation is not exclusive.");
      }
    },
  };

  try {
    await waitForActiveWriters(state);
    reservation.assertExclusive();
    return await operation(reservation);
  } finally {
    active = false;
    state.deletionReserved = false;
    cleanupMutationState(key, state);
  }
}

function mutationKey(input: { memoryId: string; storePath: string }): string {
  return `${resolve(input.storePath)}\0${input.memoryId}`;
}

function getMutationState(key: string): MutationState {
  let state = mutationStates.get(key);
  if (state === undefined) {
    state = {
      activeWriters: 0,
      deletionReserved: false,
      idleWaiters: new Set(),
    };
    mutationStates.set(key, state);
  }
  return state;
}

async function waitForActiveWriters(state: MutationState): Promise<void> {
  if (state.activeWriters === 0) {
    return;
  }
  await new Promise<void>((resolveWaiter) => {
    state.idleWaiters.add(resolveWaiter);
  });
}

function cleanupMutationState(key: string, state: MutationState): void {
  if (state.activeWriters === 0 && !state.deletionReserved) {
    mutationStates.delete(key);
  }
}

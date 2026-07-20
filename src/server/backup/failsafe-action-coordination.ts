import { AsyncLocalStorage } from "node:async_hooks";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

type ReleaseLease = () => void;

interface ActionLeaseGrant {
  owner: symbol;
  release: ReleaseLease;
}

interface ActionLeaseState {
  activeOwner: symbol | undefined;
  waiters: Array<(grant: ActionLeaseGrant) => void>;
}

const actionLeaseStates = new Map<string, ActionLeaseState>();
const activeLeaseOwners = new AsyncLocalStorage<ReadonlyMap<string, symbol>>();

/**
 * Serializes operator-approved failsafe actions for one persisted config
 * identity. Waiters are granted in arrival order so an action cannot starve
 * behind later requests.
 */
export function acquireBackupFailsafeActionLease(
  databasePath: string,
): Promise<ReleaseLease> {
  const key = resolveConfigIdentity(databasePath);
  return acquireActionLease(key).then((grant) => grant.release);
}

function acquireActionLease(key: string): Promise<ActionLeaseGrant> {
  const state = getState(key);
  if (state.activeOwner === undefined && state.waiters.length === 0) {
    const owner = Symbol(key);
    state.activeOwner = owner;
    return Promise.resolve(createGrant(key, state, owner));
  }

  return new Promise<ActionLeaseGrant>((resolveWaiter) => {
    state.waiters.push(resolveWaiter);
  });
}

function resolveConfigIdentity(databasePath: string) {
  try {
    return realpathSync(databasePath);
  } catch {
    return resolve(databasePath);
  }
}

export async function withBackupFailsafeActionLease<T>(
  databasePath: string,
  action: () => Promise<T>,
): Promise<T> {
  const key = resolveConfigIdentity(databasePath);
  const inheritedOwners = activeLeaseOwners.getStore();
  const inheritedOwner = inheritedOwners?.get(key);
  if (
    inheritedOwner !== undefined &&
    actionLeaseStates.get(key)?.activeOwner === inheritedOwner
  ) {
    return action();
  }
  const grant = await acquireActionLease(key);
  try {
    const owners = new Map(inheritedOwners ?? []);
    owners.set(key, grant.owner);
    return await activeLeaseOwners.run(owners, action);
  } finally {
    grant.release();
  }
}

function getState(key: string): ActionLeaseState {
  let state = actionLeaseStates.get(key);
  if (state === undefined) {
    state = { activeOwner: undefined, waiters: [] };
    actionLeaseStates.set(key, state);
  }
  return state;
}

function createGrant(
  key: string,
  state: ActionLeaseState,
  owner: symbol,
): ActionLeaseGrant {
  let released = false;
  return {
    owner,
    release: () => {
      if (released) {
        return;
      }
      released = true;

      const next = state.waiters.shift();
      if (next !== undefined) {
        const nextOwner = Symbol(key);
        state.activeOwner = nextOwner;
        next(createGrant(key, state, nextOwner));
        return;
      }

      state.activeOwner = undefined;
      if (actionLeaseStates.get(key) === state) {
        actionLeaseStates.delete(key);
      }
    },
  };
}

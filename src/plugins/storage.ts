import type { FocusPluginRegistry } from "./registry";
import type {
  FocusPluginPulseEntry,
  FocusPluginPulseRating,
  FocusPluginState,
  FocusPluginSurface,
} from "./types";

export const FOCUS_PLUGIN_STORAGE_KEY = "trauma.focus-plugins.v1";
export const MAX_PULSE_LOG_ENTRIES = 200;

export interface FocusPluginStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface FocusPluginStorageOptions {
  storage?: FocusPluginStorageLike | null;
  storageKey?: string;
}

export function getBrowserStorage(): FocusPluginStorageLike | null {
  try {
    if (
      typeof window === "undefined" ||
      typeof window.localStorage === "undefined"
    ) {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

function resolveStorage(
  options?: FocusPluginStorageOptions,
): FocusPluginStorageLike | null {
  if (options && "storage" in options) {
    return options.storage ?? null;
  }
  return getBrowserStorage();
}

export function loadFocusPluginState(
  registry: FocusPluginRegistry,
  options?: FocusPluginStorageOptions,
): FocusPluginState {
  const storage = resolveStorage(options);
  if (!storage) {
    return registry.computeDefaultState();
  }

  const key = options?.storageKey ?? FOCUS_PLUGIN_STORAGE_KEY;
  let serialized: string | null;
  try {
    serialized = storage.getItem(key);
  } catch {
    return registry.computeDefaultState();
  }

  if (serialized === null || serialized.trim().length === 0) {
    return registry.computeDefaultState();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return registry.computeDefaultState();
  }

  const reconciled = registry.reconcileState(parsed);
  if (reconciled.pulseLog.length > MAX_PULSE_LOG_ENTRIES) {
    return {
      ...reconciled,
      pulseLog: reconciled.pulseLog.slice(-MAX_PULSE_LOG_ENTRIES),
    };
  }
  return reconciled;
}

export function saveFocusPluginState(
  state: FocusPluginState,
  options?: FocusPluginStorageOptions,
): boolean {
  const storage = resolveStorage(options);
  if (!storage) {
    return false;
  }

  const key = options?.storageKey ?? FOCUS_PLUGIN_STORAGE_KEY;
  const boundedState: FocusPluginState =
    state.pulseLog.length > MAX_PULSE_LOG_ENTRIES
      ? {
        ...state,
        pulseLog: state.pulseLog.slice(-MAX_PULSE_LOG_ENTRIES),
      }
      : state;

  try {
    storage.setItem(key, JSON.stringify(boundedState));
    return true;
  } catch {
    return false;
  }
}

export interface CreatePulseEntryInput {
  rating: FocusPluginPulseRating;
  activePluginIds: readonly string[];
  surface?: FocusPluginSurface;
  pluginId?: string;
  note?: string;
  now?: Date;
  id?: string;
}

let pulseSequence = 0;

function generatePulseId(timestamp: Date): string {
  pulseSequence += 1;
  return `pulse-${timestamp.getTime()}-${pulseSequence}`;
}

export function createPulseEntry(
  input: CreatePulseEntryInput,
): FocusPluginPulseEntry {
  const now = input.now ?? new Date();
  const trimmedNote = input.note?.trim();
  const trimmedPluginId = input.pluginId?.trim();
  return {
    id: input.id ?? generatePulseId(now),
    rating: input.rating,
    timestamp: now.toISOString(),
    activePluginIds: [...input.activePluginIds],
    ...(input.surface !== undefined ? { surface: input.surface } : {}),
    ...(trimmedPluginId ? { pluginId: trimmedPluginId } : {}),
    ...(trimmedNote ? { note: trimmedNote } : {}),
  };
}

export function appendPulseEntry(
  state: FocusPluginState,
  entry: FocusPluginPulseEntry,
): FocusPluginState {
  const nextLog = [...state.pulseLog, entry];
  return {
    ...state,
    pulseLog: nextLog.length > MAX_PULSE_LOG_ENTRIES
      ? nextLog.slice(-MAX_PULSE_LOG_ENTRIES)
      : nextLog,
  };
}

export function clearPulseLog(state: FocusPluginState): FocusPluginState {
  return {
    ...state,
    pulseLog: [],
  };
}

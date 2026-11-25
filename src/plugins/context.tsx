import {
  createContext,
  createSignal,
  onMount,
  useContext,
  type Accessor,
  type JSX,
} from "solid-js";

import {
  computeDefaultPluginSettings,
  focusPluginRegistry,
  validateSettingValue,
  type FocusPluginRegistry,
  type SurfaceFilterOptions,
} from "./registry";
import {
  appendPulseEntry,
  clearPulseLog,
  createPulseEntry,
  loadFocusPluginState,
  saveFocusPluginState,
  type FocusPluginStorageLike,
} from "./storage";
import type {
  FocusPluginDefinition,
  FocusPluginInstanceState,
  FocusPluginPulseEntry,
  FocusPluginPulseRating,
  FocusPluginSettingValue,
  FocusPluginState,
  FocusPluginSurface,
} from "./types";

export interface RecordPulseInput {
  rating: FocusPluginPulseRating;
  surface?: FocusPluginSurface;
  pluginId?: string;
  note?: string;
}

export interface FocusPluginContextValue {
  readonly registry: FocusPluginRegistry;
  readonly plugins: Accessor<readonly FocusPluginDefinition[]>;
  readonly state: Accessor<FocusPluginState>;
  readonly hydrated: Accessor<boolean>;
  readonly pulseLog: Accessor<readonly FocusPluginPulseEntry[]>;
  getPluginsForSurface(
    surface: FocusPluginSurface,
    options?: SurfaceFilterOptions,
  ): readonly FocusPluginDefinition[];
  isPluginEnabled(pluginId: string): boolean;
  getPluginState(pluginId: string): FocusPluginInstanceState | undefined;
  getPluginSetting<
    T extends FocusPluginSettingValue = FocusPluginSettingValue,
  >(
    pluginId: string,
    key: string,
  ): T | undefined;
  getActivePluginIds(): readonly string[];
  setPluginEnabled(pluginId: string, enabled: boolean): void;
  togglePlugin(pluginId: string): void;
  setPluginSetting(
    pluginId: string,
    key: string,
    value: FocusPluginSettingValue,
  ): void;
  resetPluginSettings(pluginId: string): void;
  resetAllPlugins(): void;
  recordPulse(input: RecordPulseInput): FocusPluginPulseEntry;
  clearPulseHistory(): void;
}

const FocusPluginContext = createContext<FocusPluginContextValue>();

export interface FocusPluginProviderProps {
  children: JSX.Element;
  registry?: FocusPluginRegistry;
  storage?: FocusPluginStorageLike | null;
  storageKey?: string;
}

function createContextController(input: {
  registry: FocusPluginRegistry;
  persist: (next: FocusPluginState) => void;
  state: Accessor<FocusPluginState>;
  setState: (updater: (prev: FocusPluginState) => FocusPluginState) => void;
  hydrated: Accessor<boolean>;
}): FocusPluginContextValue {
  const { registry, persist, state, setState, hydrated } = input;

  const updateState = (
    updater: (prev: FocusPluginState) => FocusPluginState,
  ): void => {
    let nextSnapshot: FocusPluginState | undefined;
    setState((prev) => {
      const next = updater(prev);
      nextSnapshot = next;
      return next;
    });
    if (nextSnapshot !== undefined) {
      persist(nextSnapshot);
    }
  };

  const getPluginState = (
    pluginId: string,
  ): FocusPluginInstanceState | undefined => {
    return state().plugins[pluginId] ?? registry.getDefaultPluginState(pluginId);
  };

  const isPluginEnabled = (pluginId: string): boolean => {
    return getPluginState(pluginId)?.enabled ?? false;
  };

  const getActivePluginIds = (): readonly string[] => {
    const current = state();
    return registry
      .list()
      .filter((plugin) => current.plugins[plugin.id]?.enabled ?? plugin.defaultEnabled)
      .map((plugin) => plugin.id);
  };

  return {
    registry,
    plugins: () => registry.list(),
    state,
    hydrated,
    pulseLog: () => state().pulseLog,
    getPluginsForSurface: (surface, options) =>
      registry.getBySurface(surface, options),
    isPluginEnabled,
    getPluginState,
    getPluginSetting: <
      T extends FocusPluginSettingValue = FocusPluginSettingValue,
    >(
      pluginId: string,
      key: string,
    ): T | undefined => {
      const pluginState = getPluginState(pluginId);
      if (!pluginState) {
        return undefined;
      }
      return pluginState.settings[key] as T | undefined;
    },
    getActivePluginIds,
    setPluginEnabled: (pluginId, enabled) => {
      const definition = registry.get(pluginId);
      if (!definition) {
        return;
      }
      updateState((prev) => {
        const existing = prev.plugins[pluginId] ?? {
          enabled: definition.defaultEnabled,
          settings: computeDefaultPluginSettings(definition.settingsSchema),
        };
        return {
          ...prev,
          plugins: {
            ...prev.plugins,
            [pluginId]: {
              ...existing,
              enabled,
            },
          },
        };
      });
    },
    togglePlugin: (pluginId) => {
      const definition = registry.get(pluginId);
      if (!definition) {
        return;
      }
      const currentlyEnabled = isPluginEnabled(pluginId);
      updateState((prev) => {
        const existing = prev.plugins[pluginId] ?? {
          enabled: definition.defaultEnabled,
          settings: computeDefaultPluginSettings(definition.settingsSchema),
        };
        return {
          ...prev,
          plugins: {
            ...prev.plugins,
            [pluginId]: {
              ...existing,
              enabled: !currentlyEnabled,
            },
          },
        };
      });
    },
    setPluginSetting: (pluginId, key, value) => {
      const definition = registry.get(pluginId);
      if (!definition) {
        return;
      }
      const field = definition.settingsSchema.find((item) => item.key === key);
      if (!field) {
        return;
      }
      const validated = validateSettingValue(field, value);
      updateState((prev) => {
        const existing = prev.plugins[pluginId] ?? {
          enabled: definition.defaultEnabled,
          settings: computeDefaultPluginSettings(definition.settingsSchema),
        };
        return {
          ...prev,
          plugins: {
            ...prev.plugins,
            [pluginId]: {
              ...existing,
              settings: {
                ...existing.settings,
                [key]: validated,
              },
            },
          },
        };
      });
    },
    resetPluginSettings: (pluginId) => {
      const definition = registry.get(pluginId);
      if (!definition) {
        return;
      }
      updateState((prev) => {
        const existing = prev.plugins[pluginId] ?? {
          enabled: definition.defaultEnabled,
          settings: computeDefaultPluginSettings(definition.settingsSchema),
        };
        return {
          ...prev,
          plugins: {
            ...prev.plugins,
            [pluginId]: {
              ...existing,
              settings: computeDefaultPluginSettings(definition.settingsSchema),
            },
          },
        };
      });
    },
    resetAllPlugins: () => {
      updateState((prev) => ({
        ...registry.computeDefaultState(),
        pulseLog: prev.pulseLog,
      }));
    },
    recordPulse: (pulseInput) => {
      const entry = createPulseEntry({
        rating: pulseInput.rating,
        activePluginIds: getActivePluginIds(),
        surface: pulseInput.surface,
        pluginId: pulseInput.pluginId,
        note: pulseInput.note,
      });
      updateState((prev) => appendPulseEntry(prev, entry));
      return entry;
    },
    clearPulseHistory: () => {
      updateState((prev) => clearPulseLog(prev));
    },
  };
}

export function createFallbackFocusPluginContext(
  registry: FocusPluginRegistry = focusPluginRegistry,
): FocusPluginContextValue {
  let currentState = registry.computeDefaultState();
  return createContextController({
    registry,
    persist: () => undefined,
    state: () => currentState,
    setState: (updater) => {
      currentState = updater(currentState);
    },
    hydrated: () => false,
  });
}

export function FocusPluginProvider(props: FocusPluginProviderProps) {
  const registry = props.registry ?? focusPluginRegistry;
  const [state, setState] = createSignal<FocusPluginState>(
    registry.computeDefaultState(),
  );
  const [hydrated, setHydrated] = createSignal(false);

  const storageOptions = () => ({
    ...(props.storage !== undefined ? { storage: props.storage } : {}),
    ...(props.storageKey !== undefined ? { storageKey: props.storageKey } : {}),
  });

  onMount(() => {
    const loaded = loadFocusPluginState(registry, storageOptions());
    setState(loaded);
    setHydrated(true);
  });

  const value = createContextController({
    registry,
    persist: (next) => {
      saveFocusPluginState(next, storageOptions());
    },
    state,
    setState: (updater) => {
      setState(updater);
    },
    hydrated,
  });

  return (
    <FocusPluginContext.Provider value={value}>
      {props.children}
    </FocusPluginContext.Provider>
  );
}

export function useFocusPlugins(): FocusPluginContextValue {
  return (
    useContext(FocusPluginContext) ??
    createFallbackFocusPluginContext(focusPluginRegistry)
  );
}

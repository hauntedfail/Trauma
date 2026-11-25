import type {
  FocusPluginDefinition,
  FocusPluginInstanceState,
  FocusPluginPulseEntry,
  FocusPluginPulseRating,
  FocusPluginSettingField,
  FocusPluginSettingValue,
  FocusPluginSettingValues,
  FocusPluginSettingsSchema,
  FocusPluginState,
  FocusPluginSurface,
} from "./types";

const VALID_SURFACES = new Set<FocusPluginSurface>([
  "reader",
  "psychiatrist",
  "browse",
  "global",
]);

const VALID_PULSE_RATINGS = new Set<FocusPluginPulseRating>([
  "helped",
  "neutral",
  "distracting",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateSettingValue(
  field: FocusPluginSettingField,
  raw: unknown,
): FocusPluginSettingValue {
  switch (field.type) {
    case "boolean":
      return typeof raw === "boolean" ? raw : field.defaultValue;
    case "number": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        return field.defaultValue;
      }
      let next = raw;
      if (field.min !== undefined && next < field.min) {
        next = field.min;
      }
      if (field.max !== undefined && next > field.max) {
        next = field.max;
      }
      return next;
    }
    case "select": {
      if (
        typeof raw === "string" &&
        field.options.some((option) => option.value === raw)
      ) {
        return raw;
      }
      return field.defaultValue;
    }
  }
}

export function computeDefaultPluginSettings(
  schema: FocusPluginSettingsSchema,
): FocusPluginSettingValues {
  const settings: FocusPluginSettingValues = {};
  for (const field of schema) {
    settings[field.key] = field.defaultValue;
  }
  return settings;
}

export function sanitizePluginSettings(
  schema: FocusPluginSettingsSchema,
  raw: unknown,
): FocusPluginSettingValues {
  const source = isRecord(raw) ? raw : {};
  const settings: FocusPluginSettingValues = {};
  for (const field of schema) {
    settings[field.key] = validateSettingValue(field, source[field.key]);
  }
  return settings;
}

function sanitizePulseEntry(raw: unknown): FocusPluginPulseEntry | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const id = typeof raw.id === "string" && raw.id.trim().length > 0
    ? raw.id
    : undefined;
  const rating = typeof raw.rating === "string" &&
      VALID_PULSE_RATINGS.has(raw.rating as FocusPluginPulseRating)
    ? (raw.rating as FocusPluginPulseRating)
    : undefined;
  const timestamp = typeof raw.timestamp === "string" &&
      raw.timestamp.trim().length > 0
    ? raw.timestamp
    : undefined;

  if (!id || !rating || !timestamp) {
    return undefined;
  }

  const activePluginIds = Array.isArray(raw.activePluginIds)
    ? raw.activePluginIds.filter((item): item is string =>
      typeof item === "string" && item.trim().length > 0
    )
    : [];

  const surface = typeof raw.surface === "string" &&
      VALID_SURFACES.has(raw.surface as FocusPluginSurface)
    ? (raw.surface as FocusPluginSurface)
    : undefined;
  const pluginId = typeof raw.pluginId === "string" &&
      raw.pluginId.trim().length > 0
    ? raw.pluginId
    : undefined;
  const note = typeof raw.note === "string" && raw.note.trim().length > 0
    ? raw.note.trim()
    : undefined;

  return {
    id,
    rating,
    timestamp,
    activePluginIds,
    ...(surface !== undefined ? { surface } : {}),
    ...(pluginId !== undefined ? { pluginId } : {}),
    ...(note !== undefined ? { note } : {}),
  };
}

export interface RegisterPluginOptions {
  replace?: boolean;
}

export interface SurfaceFilterOptions {
  includeGlobal?: boolean;
}

export class FocusPluginRegistry {
  private readonly definitions = new Map<string, FocusPluginDefinition>();

  register(
    definition: FocusPluginDefinition,
    options?: RegisterPluginOptions,
  ): void {
    const id = definition.id.trim();
    if (id.length === 0) {
      throw new Error("Focus plugin id must be a non-empty string.");
    }
    if (this.definitions.has(id) && options?.replace !== true) {
      throw new Error(`Focus plugin "${id}" is already registered.`);
    }
    this.definitions.set(id, {
      ...definition,
      id,
    });
  }

  registerAll(
    definitions: readonly FocusPluginDefinition[],
    options?: RegisterPluginOptions,
  ): void {
    for (const definition of definitions) {
      this.register(definition, options);
    }
  }

  unregister(id: string): boolean {
    return this.definitions.delete(id);
  }

  clear(): void {
    this.definitions.clear();
  }

  has(id: string): boolean {
    return this.definitions.has(id);
  }

  get(id: string): FocusPluginDefinition | undefined {
    return this.definitions.get(id);
  }

  list(): readonly FocusPluginDefinition[] {
    return [...this.definitions.values()];
  }

  getBySurface(
    surface: FocusPluginSurface,
    options?: SurfaceFilterOptions,
  ): readonly FocusPluginDefinition[] {
    const includeGlobal = options?.includeGlobal === true;
    return this.list().filter((definition) =>
      definition.surface === surface ||
      (includeGlobal && definition.surface === "global")
    );
  }

  getDefaultPluginState(id: string): FocusPluginInstanceState | undefined {
    const definition = this.definitions.get(id);
    if (!definition) {
      return undefined;
    }
    return {
      enabled: definition.defaultEnabled,
      settings: computeDefaultPluginSettings(definition.settingsSchema),
    };
  }

  computeDefaultState(): FocusPluginState {
    const plugins: Record<string, FocusPluginInstanceState> = {};
    for (const definition of this.definitions.values()) {
      plugins[definition.id] = {
        enabled: definition.defaultEnabled,
        settings: computeDefaultPluginSettings(definition.settingsSchema),
      };
    }
    return {
      version: 1,
      plugins,
      pulseLog: [],
    };
  }

  reconcileState(raw: unknown): FocusPluginState {
    const defaults = this.computeDefaultState();
    if (!isRecord(raw)) {
      return defaults;
    }

    const rawPlugins = isRecord(raw.plugins) ? raw.plugins : {};
    const plugins: Record<string, FocusPluginInstanceState> = {};

    for (const definition of this.definitions.values()) {
      const candidate = rawPlugins[definition.id];
      if (!isRecord(candidate)) {
        plugins[definition.id] = {
          enabled: definition.defaultEnabled,
          settings: computeDefaultPluginSettings(definition.settingsSchema),
        };
        continue;
      }

      plugins[definition.id] = {
        enabled: typeof candidate.enabled === "boolean"
          ? candidate.enabled
          : definition.defaultEnabled,
        settings: sanitizePluginSettings(
          definition.settingsSchema,
          candidate.settings,
        ),
      };
    }

    const pulseLog: FocusPluginPulseEntry[] = [];
    if (Array.isArray(raw.pulseLog)) {
      for (const entry of raw.pulseLog) {
        const sanitized = sanitizePulseEntry(entry);
        if (sanitized) {
          pulseLog.push(sanitized);
        }
      }
    }

    return {
      version: 1,
      plugins,
      pulseLog,
    };
  }
}

export function createFocusPluginRegistry(
  initialDefinitions: readonly FocusPluginDefinition[] = [],
): FocusPluginRegistry {
  const registry = new FocusPluginRegistry();
  registry.registerAll(initialDefinitions);
  return registry;
}

export const focusPluginRegistry = createFocusPluginRegistry();

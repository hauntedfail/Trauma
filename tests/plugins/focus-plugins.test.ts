import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  FOCUS_PLUGIN_STORAGE_KEY,
  FocusPluginProvider,
  MAX_PULSE_LOG_ENTRIES,
  appendPulseEntry,
  clearPulseLog,
  computeDefaultPluginSettings,
  createFallbackFocusPluginContext,
  createFocusPluginRegistry,
  createPulseEntry,
  loadFocusPluginState,
  sanitizePluginSettings,
  saveFocusPluginState,
  useFocusPlugins,
  validateSettingValue,
  type FocusPluginDefinition,
  type FocusPluginStorageLike,
} from "../../src/plugins";
import { FocusPluginsSettingsSection } from "../../src/components/settings/SettingsPage";

const SAMPLE_READER_PLUGIN: FocusPluginDefinition = {
  id: "reading-ruler",
  name: "Reading Ruler",
  description: "Visual reading guide bar that follows focus.",
  surface: "reader",
  evidenceLevel: "high",
  evidenceSummary: "Supported by CHI '23 digital reading ruler trials.",
  defaultEnabled: false,
  settingsSchema: [
    {
      type: "select",
      key: "style",
      label: "Ruler style",
      defaultValue: "grey-bar",
      options: [
        { value: "grey-bar", label: "Grey Bar" },
        { value: "lightbox", label: "Lightbox" },
        { value: "shade", label: "Shade" },
        { value: "underline", label: "Underline" },
      ],
    },
    {
      type: "number",
      key: "opacity",
      label: "Opacity",
      defaultValue: 35,
      min: 10,
      max: 90,
      step: 5,
      unit: "%",
    },
    {
      type: "boolean",
      key: "keyboardNavigation",
      label: "Enable j/k navigation",
      defaultValue: true,
    },
  ],
};

const SAMPLE_GLOBAL_PLUGIN: FocusPluginDefinition = {
  id: "gentle-ambient-tint",
  name: "Gentle Ambient Tint",
  description: "Soft visual transition across views.",
  surface: "global",
  evidenceLevel: "experimental",
  defaultEnabled: true,
  settingsSchema: [],
};

const SAMPLE_PSYCHIATRIST_PLUGIN: FocusPluginDefinition = {
  id: "adaptive-ai-presenter",
  name: "Adaptive AI Presenter",
  description: "Structures verbose AI replies into scannable blocks.",
  surface: "psychiatrist",
  evidenceLevel: "moderate",
  defaultEnabled: false,
  settingsSchema: [
    {
      type: "number",
      key: "maxBullets",
      label: "Max bullets before fold",
      defaultValue: 4,
      min: 2,
      max: 10,
    },
  ],
};

function createMemoryStorage(
  initial: Record<string, string> = {},
): FocusPluginStorageLike & { dump(): Record<string, string> } {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    dump(): Record<string, string> {
      return Object.fromEntries(store.entries());
    },
  };
}

describe("FocusPluginRegistry", () => {
  it("registers, looks up, filters by surface, and computes defaults", () => {
    const registry = createFocusPluginRegistry([
      SAMPLE_READER_PLUGIN,
      SAMPLE_GLOBAL_PLUGIN,
      SAMPLE_PSYCHIATRIST_PLUGIN,
    ]);

    expect(registry.has("reading-ruler")).toBe(true);
    expect(registry.get("reading-ruler")?.name).toBe("Reading Ruler");
    expect(registry.list()).toHaveLength(3);

    expect(registry.getBySurface("reader").map((p) => p.id)).toEqual([
      "reading-ruler",
    ]);
    expect(
      registry.getBySurface("reader", { includeGlobal: true }).map((p) => p.id),
    ).toEqual(["reading-ruler", "gentle-ambient-tint"]);
    expect(registry.getBySurface("psychiatrist").map((p) => p.id)).toEqual([
      "adaptive-ai-presenter",
    ]);
    expect(registry.getBySurface("browse")).toEqual([]);

    const defaultState = registry.computeDefaultState();
    expect(defaultState).toEqual({
      version: 1,
      plugins: {
        "reading-ruler": {
          enabled: false,
          settings: {
            style: "grey-bar",
            opacity: 35,
            keyboardNavigation: true,
          },
        },
        "gentle-ambient-tint": {
          enabled: true,
          settings: {},
        },
        "adaptive-ai-presenter": {
          enabled: false,
          settings: {
            maxBullets: 4,
          },
        },
      },
      pulseLog: [],
    });
  });

  it("rejects duplicate or empty plugin IDs unless replace is enabled", () => {
    const registry = createFocusPluginRegistry([SAMPLE_READER_PLUGIN]);

    expect(() =>
      registry.register({
        ...SAMPLE_READER_PLUGIN,
        id: "   ",
      }),
    ).toThrow(/non-empty/);

    expect(() => registry.register(SAMPLE_READER_PLUGIN)).toThrow(
      /already registered/,
    );

    registry.register(
      {
        ...SAMPLE_READER_PLUGIN,
        name: "Updated Reading Ruler",
      },
      { replace: true },
    );
    expect(registry.get("reading-ruler")?.name).toBe("Updated Reading Ruler");
    expect(registry.unregister("reading-ruler")).toBe(true);
    expect(registry.has("reading-ruler")).toBe(false);
  });
});

describe("settings validation and defaults", () => {
  it("validates boolean, number (with clamping), and select fields", () => {
    const [selectField, numberField, boolField] =
      SAMPLE_READER_PLUGIN.settingsSchema;

    expect(validateSettingValue(selectField!, "lightbox")).toBe("lightbox");
    expect(validateSettingValue(selectField!, "invalid-mode")).toBe("grey-bar");
    expect(validateSettingValue(selectField!, 123)).toBe("grey-bar");

    expect(validateSettingValue(numberField!, 50)).toBe(50);
    expect(validateSettingValue(numberField!, 2)).toBe(10);
    expect(validateSettingValue(numberField!, 999)).toBe(90);
    expect(validateSettingValue(numberField!, Number.NaN)).toBe(35);
    expect(validateSettingValue(numberField!, "50")).toBe(35);

    expect(validateSettingValue(boolField!, false)).toBe(false);
    expect(validateSettingValue(boolField!, "true")).toBe(true);
  });

  it("computes defaults and strips unknown keys during sanitization", () => {
    expect(
      computeDefaultPluginSettings(SAMPLE_READER_PLUGIN.settingsSchema),
    ).toEqual({
      style: "grey-bar",
      opacity: 35,
      keyboardNavigation: true,
    });

    expect(
      sanitizePluginSettings(SAMPLE_READER_PLUGIN.settingsSchema, {
        style: "shade",
        opacity: 150,
        keyboardNavigation: "not-a-bool",
        extraUnknown: "ignored",
      }),
    ).toEqual({
      style: "shade",
      opacity: 90,
      keyboardNavigation: true,
    });
  });
});

describe("SSR-safe storage and corrupted JSON fallback", () => {
  const registry = createFocusPluginRegistry([
    SAMPLE_READER_PLUGIN,
    SAMPLE_GLOBAL_PLUGIN,
  ]);

  it("returns defaults safely when storage is unavailable (SSR)", () => {
    const state = loadFocusPluginState(registry, { storage: null });
    expect(state).toEqual(registry.computeDefaultState());
    expect(saveFocusPluginState(state, { storage: null })).toBe(false);
  });

  it("falls back cleanly to defaults on corrupted, non-object, or throwing storage", () => {
    const malformedCases = [
      "{not-valid-json",
      "null",
      "42",
      '"string"',
      "[]",
      JSON.stringify({ plugins: "broken", pulseLog: "broken" }),
    ];

    for (const raw of malformedCases) {
      const storage = createMemoryStorage({ [FOCUS_PLUGIN_STORAGE_KEY]: raw });
      expect(loadFocusPluginState(registry, { storage })).toEqual(
        registry.computeDefaultState(),
      );
    }

    const throwingStorage: FocusPluginStorageLike = {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("QuotaExceededError");
      },
    };

    expect(
      loadFocusPluginState(registry, { storage: throwingStorage }),
    ).toEqual(registry.computeDefaultState());
    expect(
      saveFocusPluginState(registry.computeDefaultState(), {
        storage: throwingStorage,
      }),
    ).toBe(false);
  });

  it("round-trips valid state while discarding unknown plugins and malformed fields", () => {
    const storage = createMemoryStorage({
      [FOCUS_PLUGIN_STORAGE_KEY]: JSON.stringify({
        version: 1,
        plugins: {
          "reading-ruler": {
            enabled: true,
            settings: {
              style: "underline",
              opacity: 200,
              keyboardNavigation: false,
            },
          },
          "unknown-legacy-plugin": {
            enabled: true,
            settings: { foo: "bar" },
          },
        },
        pulseLog: [
          {
            id: "p1",
            rating: "helped",
            timestamp: "2026-11-24T12:00:00.000Z",
            activePluginIds: ["reading-ruler", 42],
            surface: "reader",
          },
          {
            id: "bad-rating",
            rating: "amazing",
            timestamp: "2026-11-24T12:01:00.000Z",
            activePluginIds: [],
          },
        ],
      }),
    });

    const loaded = loadFocusPluginState(registry, { storage });
    expect(loaded.plugins["reading-ruler"]).toEqual({
      enabled: true,
      settings: {
        style: "underline",
        opacity: 90,
        keyboardNavigation: false,
      },
    });
    expect(loaded.plugins["gentle-ambient-tint"]).toEqual({
      enabled: true,
      settings: {},
    });
    expect("unknown-legacy-plugin" in loaded.plugins).toBe(false);
    expect(loaded.pulseLog).toEqual([
      {
        id: "p1",
        rating: "helped",
        timestamp: "2026-11-24T12:00:00.000Z",
        activePluginIds: ["reading-ruler"],
        surface: "reader",
      },
    ]);

    expect(saveFocusPluginState(loaded, { storage })).toBe(true);
    const reloaded = loadFocusPluginState(registry, { storage });
    expect(reloaded).toEqual(loaded);
  });
});

describe("RSD-safe pulse logging", () => {
  it("appends, caps at MAX_PULSE_LOG_ENTRIES, and clears pulse history", () => {
    const registry = createFocusPluginRegistry([SAMPLE_READER_PLUGIN]);
    let state = registry.computeDefaultState();

    for (let i = 0; i < MAX_PULSE_LOG_ENTRIES + 10; i += 1) {
      const entry = createPulseEntry({
        id: `pulse-${i}`,
        rating: i % 3 === 0 ? "helped" : i % 3 === 1 ? "neutral" : "distracting",
        activePluginIds: ["reading-ruler"],
        surface: "reader",
        now: new Date(1_700_000_000_000 + i * 1000),
      });
      state = appendPulseEntry(state, entry);
    }

    expect(state.pulseLog).toHaveLength(MAX_PULSE_LOG_ENTRIES);
    expect(state.pulseLog[0]?.id).toBe("pulse-10");
    expect(state.pulseLog.at(-1)?.id).toBe(
      `pulse-${MAX_PULSE_LOG_ENTRIES + 9}`,
    );

    const cleared = clearPulseLog(state);
    expect(cleared.pulseLog).toEqual([]);
  });
});

describe("SolidStart SSR & provider fallback", () => {
  it("falls back safely when useFocusPlugins is called outside FocusPluginProvider", () => {
    function OutsideConsumer() {
      const ctx = useFocusPlugins();
      return `hydrated:${String(ctx.hydrated())},count:${ctx.plugins().length}`;
    }

    const html = renderToString(() => createComponent(OutsideConsumer, {}));
    expect(html).toContain("hydrated:false");

    const fallback = createFallbackFocusPluginContext(
      createFocusPluginRegistry([SAMPLE_READER_PLUGIN]),
    );
    expect(fallback.isPluginEnabled("reading-ruler")).toBe(false);
    fallback.togglePlugin("reading-ruler");
    expect(fallback.isPluginEnabled("reading-ruler")).toBe(true);
    fallback.setPluginSetting("reading-ruler", "opacity", 65);
    expect(fallback.getPluginSetting("reading-ruler", "opacity")).toBe(65);
    const entry = fallback.recordPulse({ rating: "helped", surface: "reader" });
    expect(entry.activePluginIds).toEqual(["reading-ruler"]);
    expect(fallback.pulseLog()).toHaveLength(1);
  });

  it("renders FocusPluginsSettingsSection cleanly under SSR", () => {
    const registry = createFocusPluginRegistry([
      SAMPLE_READER_PLUGIN,
      SAMPLE_GLOBAL_PLUGIN,
    ]);

    const settingsHtml = renderToString(() =>
      createComponent(FocusPluginProvider, {
        registry,
        storage: null,
        get children() {
          return createComponent(FocusPluginsSettingsSection, {});
        },
      }),
    );

    expect(settingsHtml).toContain("Focus Plugins");
    expect(settingsHtml).toContain("Reading Ruler");
    expect(settingsHtml).toContain("High evidence");
    expect(settingsHtml).toContain("Experimental");
    expect(settingsHtml).toContain("Ruler style");
    expect(settingsHtml).toContain("Opacity");
    expect(settingsHtml).toContain("Enable j/k navigation");
    expect(settingsHtml).toContain("Helped");
    expect(settingsHtml).toContain("Neutral");
    expect(settingsHtml).toContain("Distracting");
  });
});

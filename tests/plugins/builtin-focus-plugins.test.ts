import { existsSync, readFileSync } from "node:fs";
import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  ADAPTIVE_AI_PRESENTER_PLUGIN_ID,
  AdaptiveAiResponse,
  BUILTIN_FOCUS_PLUGINS,
  EPHEMERAL_SHELF_TRIAGE_DEFINITION,
  EPHEMERAL_SHELF_TRIAGE_PLUGIN_ID,
  FocusPluginProvider,
  READING_RULER_PLUGIN_ID,
  RESUMPTION_BEACON_PLUGIN_ID,
  ReadingRulerOverlay,
  ResumptionBeacon,
  computeReadingRulerGeometry,
  createFocusPluginRegistry,
  focusPluginRegistry,
  hasResumableLastPosition,
  restructureAiResponse,
  shouldTriggerResumptionCue,
} from "../../src/plugins";

describe("built-in starter focus plugins", () => {
  it("registers all 4 starter plugins in the default registry with opt-in defaults", () => {
    const ids = focusPluginRegistry.list().map((plugin) => plugin.id);
    expect(ids).toEqual([
      READING_RULER_PLUGIN_ID,
      RESUMPTION_BEACON_PLUGIN_ID,
      ADAPTIVE_AI_PRESENTER_PLUGIN_ID,
      EPHEMERAL_SHELF_TRIAGE_PLUGIN_ID,
    ]);
    for (const plugin of BUILTIN_FOCUS_PLUGINS) {
      expect(plugin.defaultEnabled).toBe(false);
    }
  });

  it("computes clamped geometry for reading-ruler", () => {
    const middle = computeReadingRulerGeometry({
      viewportHeight: 900,
      anchorY: 400,
      windowLines: 2,
    });
    expect(middle).toEqual({
      topPx: 370,
      bandHeightPx: 60,
      bottomStartPx: 430,
    });

    const topClamped = computeReadingRulerGeometry({
      viewportHeight: 900,
      anchorY: -50,
      windowLines: 3,
    });
    expect(topClamped.topPx).toBe(0);
    expect(topClamped.bandHeightPx).toBe(90);

    const bottomClamped = computeReadingRulerGeometry({
      viewportHeight: 500,
      anchorY: 999,
      windowLines: 5,
    });
    expect(bottomClamped.bottomStartPx).toBe(500);
    expect(bottomClamped.bandHeightPx).toBe(150);
  });

  it("evaluates core last_position resumability and away threshold without duplicating persistence", () => {
    expect(hasResumableLastPosition(null)).toBe(false);
    expect(
      hasResumableLastPosition({
        variant: "source",
        headingId: null,
        paragraphIndex: 0,
        scrollRatio: 0,
        updatedAt: "2026-11-25T00:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      hasResumableLastPosition(
        {
          variant: "ja",
          headingId: "section-2",
          paragraphIndex: 2,
          scrollRatio: 0.4,
          updatedAt: "2026-11-25T00:00:00.000Z",
        },
        "source",
      ),
    ).toBe(false);
    expect(
      hasResumableLastPosition(
        {
          variant: "source",
          headingId: "section-2",
          paragraphIndex: 2,
          scrollRatio: 0.4,
          updatedAt: "2026-11-25T00:00:00.000Z",
        },
        "source",
      ),
    ).toBe(true);

    expect(
      shouldTriggerResumptionCue({
        hiddenAtMs: 1000,
        returnedAtMs: 25_000,
        thresholdSeconds: 30,
      }),
    ).toBe(false);
    expect(
      shouldTriggerResumptionCue({
        hiddenAtMs: 1000,
        returnedAtMs: 31_000,
        thresholdSeconds: 30,
      }),
    ).toBe(true);

    const beaconSource = readFileSync("src/plugins/builtin/ResumptionBeacon.tsx", "utf8");
    expect(beaconSource).not.toContain("localStorage");
    expect(beaconSource).not.toContain("getBrowserStorage");
    expect(beaconSource).toContain("z-40");
  });

  it("restructures verbose Psychiatrist responses into TL;DR and anchored bullets", () => {
    const shortReply = restructureAiResponse("Short direct answer.");
    expect(shortReply.shouldAdapt).toBe(false);

    const verboseReply = restructureAiResponse(
      "Main takeaway: chunking reduces working-memory load.\n- **Chunking**: Break long walls of text into 3-point groups.\n- **Anchors**: Bold leading concepts so eyes lock quickly.\n- **Control**: Keep an instant Original toggle for trust.",
    );
    expect(verboseReply.shouldAdapt).toBe(true);
    expect(verboseReply.tldr).toContain("Main takeaway");
    expect(verboseReply.bullets).toHaveLength(3);
    expect(verboseReply.bullets[0]).toEqual({
      anchor: "Chunking",
      body: "Break long walls of text into 3-point groups.",
    });

    const qualifiedReply = restructureAiResponse(
      [
        "Intro summary.",
        "- **Fact A**: First fact.",
        "  Continuation of first fact.",
        "- **Fact B**: Second fact.",
        "",
        "Final qualification that must not be dropped.",
      ].join("\n"),
    );
    expect(qualifiedReply.shouldAdapt).toBe(true);
    expect(qualifiedReply.tldr).toBe("Intro summary.");
    expect(qualifiedReply.bullets).toEqual([
      { anchor: "Fact A", body: "First fact. Continuation of first fact." },
      { anchor: "Fact B", body: "Second fact." },
      { body: "Final qualification that must not be dropped." },
    ]);
  });

  it("removes EphemeralShelfBar while keeping ephemeral-shelf-triage TTL and cap settings", () => {
    expect(existsSync("src/plugins/builtin/EphemeralShelfBar.tsx")).toBe(false);
    const builtinIndex = readFileSync("src/plugins/builtin/index.ts", "utf8");
    const pluginsIndex = readFileSync("src/plugins/index.ts", "utf8");
    expect(builtinIndex).not.toContain("EphemeralShelfBar");
    expect(pluginsIndex).not.toContain("EphemeralShelfBar");

    const settingKeys = EPHEMERAL_SHELF_TRIAGE_DEFINITION.settingsSchema.map(
      (field) => field.key,
    );
    expect(settingKeys).toEqual([
      "shelfTtlDays",
      "shelfExpiryAction",
      "dailyPickCap",
      "rsdSafeLabels",
    ]);
  });

  it("renders reader and psychiatrist plugin UI components safely under SSR when enabled", () => {
    const enabledRegistry = createFocusPluginRegistry(
      BUILTIN_FOCUS_PLUGINS.map((plugin) => ({
        ...plugin,
        defaultEnabled: true,
      })),
    );

    const rulerHtml = renderToString(() =>
      createComponent(FocusPluginProvider, {
        registry: enabledRegistry,
        storage: null,
        get children() {
          return createComponent(ReadingRulerOverlay, {});
        },
      }),
    );
    expect(rulerHtml).toContain('data-focus-plugin="reading-ruler"');
    expect(rulerHtml).toContain("z-40");

    const beaconHtml = renderToString(() =>
      createComponent(FocusPluginProvider, {
        registry: enabledRegistry,
        storage: null,
        get children() {
          return createComponent(ResumptionBeacon, {
            memoryId: "mem-1",
            activeVariant: "source",
            lastPosition: {
              variant: "source",
              headingId: "section-2",
              paragraphIndex: 2,
              scrollRatio: 0.4,
              updatedAt: "2026-11-25T00:00:00.000Z",
            },
            getBodyContainer: () => undefined,
          });
        },
      }),
    );
    expect(beaconHtml).toContain('data-focus-plugin="resumption-beacon"');
    expect(beaconHtml).toContain("Jump to last spot");

    const emptyBeaconHtml = renderToString(() =>
      createComponent(FocusPluginProvider, {
        registry: enabledRegistry,
        storage: null,
        get children() {
          return createComponent(ResumptionBeacon, {
            memoryId: "mem-1",
            activeVariant: "source",
            lastPosition: null,
            getBodyContainer: () => undefined,
          });
        },
      }),
    );
    expect(emptyBeaconHtml).not.toContain('data-focus-plugin="resumption-beacon"');

    const aiHtml = renderToString(() =>
      createComponent(FocusPluginProvider, {
        registry: enabledRegistry,
        storage: null,
        get children() {
          return createComponent(AdaptiveAiResponse, {
            text: "Summary sentence.\n- **Point A**: First explanation.\n- **Point B**: Second explanation.",
          });
        },
      }),
    );
    expect(aiHtml).toContain('data-focus-plugin="adaptive-ai-presenter"');
    expect(aiHtml).toContain("TL;DR");
    expect(aiHtml).toContain("Original");
  });

  it("disables psychiatrist sheet, rail reveal, ruler, and beacon transitions under prefers-reduced-motion", () => {
    const css = readFileSync("src/styles/tailwind.css", "utf8");
    const reducedMotionStart = css.lastIndexOf("@media (prefers-reduced-motion: reduce)");
    expect(reducedMotionStart).toBeGreaterThan(-1);
    const reducedMotionBlock = css.slice(reducedMotionStart);
    expect(reducedMotionBlock).toContain(".trauma-reader-topbar");
    expect(reducedMotionBlock).toContain(".trauma-reader-landmark-rail");
    expect(reducedMotionBlock).toContain(".trauma-reader-psychiatrist-sheet");
    expect(reducedMotionBlock).toContain(".trauma-resumption-beacon-pill");
    expect(reducedMotionBlock).toContain(".trauma-reading-ruler-band");
    expect(reducedMotionBlock).toContain("[data-resumption-beacon-highlight]");
  });
});

import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";

import type { MemoryLastPosition } from "../../components/memories/browse-data";
import { useFocusPlugins } from "../context";
import { RESUMPTION_BEACON_PLUGIN_ID } from "./definitions";

const TRACKED_BLOCK_SELECTOR = "p, h1, h2, h3, h4, blockquote, li, pre";

export function shouldTriggerResumptionCue(input: {
  hiddenAtMs: number | null;
  returnedAtMs: number;
  thresholdSeconds: number;
}): boolean {
  if (input.hiddenAtMs === null) {
    return false;
  }
  const elapsedMs = input.returnedAtMs - input.hiddenAtMs;
  return elapsedMs >= Math.max(1, input.thresholdSeconds) * 1000;
}

export function hasResumableLastPosition(
  lastPosition: MemoryLastPosition | null | undefined,
  activeVariant?: string,
): boolean {
  if (!lastPosition) {
    return false;
  }
  if (activeVariant !== undefined && lastPosition.variant !== activeVariant) {
    return false;
  }
  return (
    lastPosition.headingId !== null ||
    lastPosition.paragraphIndex > 0 ||
    lastPosition.scrollRatio > 0
  );
}

function escapeCssSelector(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function extractSnippet(element: HTMLElement): string {
  const normalized = (element.textContent ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= 96) {
    return normalized;
  }
  return `${normalized.slice(0, 93)}…`;
}

function queryReadableBlocks(container: HTMLElement | undefined): HTMLElement[] {
  if (!container) {
    return [];
  }
  return Array.from(
    container.querySelectorAll<HTMLElement>(TRACKED_BLOCK_SELECTOR),
  ).filter((el) => (el.textContent ?? "").trim().length > 0);
}

export interface ResumptionTarget {
  readonly target: HTMLElement;
  readonly previous: HTMLElement | null;
  readonly snippet: string;
}

export function resolveResumptionTargetElement(input: {
  activeVariant?: string;
  bodyContainer: HTMLElement | undefined;
  lastPosition: MemoryLastPosition | null | undefined;
  rootContainer?: HTMLElement | undefined;
}): ResumptionTarget | null {
  const { lastPosition } = input;
  if (!hasResumableLastPosition(lastPosition, input.activeVariant) || !lastPosition) {
    return null;
  }

  const blocks = queryReadableBlocks(input.bodyContainer);
  const searchRoot = input.rootContainer ?? input.bodyContainer;

  if (lastPosition.headingId !== null && searchRoot !== undefined) {
    const escapedId = escapeCssSelector(lastPosition.headingId);
    const headingEl =
      searchRoot.querySelector<HTMLElement>(
        `[data-reader-section-anchor="${escapedId}"]`,
      ) ?? searchRoot.querySelector<HTMLElement>(`#${escapedId}`);
    if (headingEl !== null) {
      const idx = blocks.indexOf(headingEl);
      const previous = idx > 0 ? blocks[idx - 1] ?? null : null;
      return {
        target: headingEl,
        previous,
        snippet: extractSnippet(headingEl),
      };
    }
  }

  if (blocks.length > 0) {
    const clampedIndex = Math.min(
      Math.max(0, lastPosition.paragraphIndex),
      blocks.length - 1,
    );
    const target = blocks[clampedIndex];
    if (target) {
      return {
        target,
        previous: clampedIndex > 0 ? blocks[clampedIndex - 1] ?? null : null,
        snippet: extractSnippet(target),
      };
    }
  }

  return null;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface ResumptionBeaconProps {
  memoryId: string;
  activeVariant?: string;
  lastPosition: MemoryLastPosition | null | undefined;
  getBodyContainer: () => HTMLElement | undefined;
  getRootContainer?: () => HTMLElement | undefined;
}

export function ResumptionBeacon(props: ResumptionBeaconProps) {
  const focusPlugins = useFocusPlugins();
  const isEnabled = createMemo(() =>
    focusPlugins.isPluginEnabled(RESUMPTION_BEACON_PLUGIN_ID),
  );
  const awayThresholdSeconds = createMemo<number>(() => {
    const raw = focusPlugins.getPluginSetting<string>(
      RESUMPTION_BEACON_PLUGIN_ID,
      "awayThresholdSeconds",
    );
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
  });
  const cueStyle = createMemo<"context-pair" | "single-block">(() => {
    const raw = focusPlugins.getPluginSetting<string>(
      RESUMPTION_BEACON_PLUGIN_ID,
      "cueStyle",
    );
    return raw === "single-block" ? "single-block" : "context-pair";
  });
  const fadeSeconds = createMemo<number>(() => {
    const raw = focusPlugins.getPluginSetting<number>(
      RESUMPTION_BEACON_PLUGIN_ID,
      "fadeSeconds",
    );
    return typeof raw === "number" && Number.isFinite(raw) ? raw : 8;
  });

  const hasPosition = createMemo(() =>
    hasResumableLastPosition(props.lastPosition, props.activeVariant),
  );
  const [dismissed, setDismissed] = createSignal(false);
  const [statusNote, setStatusNote] = createSignal("");

  let activeHighlights: HTMLElement[] = [];
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;

  const clearHighlights = () => {
    if (fadeTimer !== undefined) {
      clearTimeout(fadeTimer);
      fadeTimer = undefined;
    }
    for (const el of activeHighlights) {
      el.removeAttribute("data-resumption-beacon-highlight");
    }
    activeHighlights = [];
  };

  const applyContextHighlight = () => {
    clearHighlights();
    const resolved = resolveResumptionTargetElement({
      activeVariant: props.activeVariant,
      bodyContainer: props.getBodyContainer(),
      lastPosition: props.lastPosition,
      rootContainer: props.getRootContainer?.(),
    });
    if (!resolved) {
      return;
    }

    const targets: HTMLElement[] = [resolved.target];
    if (cueStyle() === "context-pair" && resolved.previous !== null) {
      targets.unshift(resolved.previous);
    }

    for (const el of targets) {
      const isPrimary = el === resolved.target;
      el.setAttribute(
        "data-resumption-beacon-highlight",
        isPrimary ? "current" : "previous",
      );
    }
    activeHighlights = targets;
    fadeTimer = setTimeout(() => {
      clearHighlights();
    }, fadeSeconds() * 1000);
  };

  const jumpToLastPosition = () => {
    const resolved = resolveResumptionTargetElement({
      activeVariant: props.activeVariant,
      bodyContainer: props.getBodyContainer(),
      lastPosition: props.lastPosition,
      rootContainer: props.getRootContainer?.(),
    });
    if (!resolved) {
      return;
    }
    resolved.target.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "center",
    });
    applyContextHighlight();
    setStatusNote("Jumped to saved spot");
    setTimeout(() => setStatusNote(""), 2500);
  };

  createEffect(() => {
    // Re-evaluate when memory, variant, or core last_position changes.
    const _memoryId = props.memoryId;
    const _position = props.lastPosition;
    const _variant = props.activeVariant;
    void _memoryId;
    void _position;
    void _variant;

    if (!isEnabled() || typeof window === "undefined") {
      clearHighlights();
      return;
    }

    if (hasPosition()) {
      setDismissed(false);
      applyContextHighlight();
    } else {
      clearHighlights();
    }

    let hiddenAtMs: number | null = null;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtMs = Date.now();
        return;
      }
      if (
        document.visibilityState === "visible" &&
        hasPosition() &&
        shouldTriggerResumptionCue({
          hiddenAtMs,
          returnedAtMs: Date.now(),
          thresholdSeconds: awayThresholdSeconds(),
        })
      ) {
        setDismissed(false);
        applyContextHighlight();
      }
      hiddenAtMs = null;
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    onCleanup(() => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearHighlights();
    });
  });

  return (
    <Show when={isEnabled() && hasPosition() && !dismissed()}>
      <div
        class="trauma-resumption-beacon-pill fixed bottom-5 right-5 z-40 flex flex-wrap items-center gap-2 rounded-full border border-trauma-border bg-trauma-bg-elev/95 px-3 py-1.5 text-xs text-trauma-text-primary shadow-md backdrop-blur"
        data-focus-plugin="resumption-beacon"
        role="region"
        aria-label="Resumption Beacon"
      >
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-full bg-trauma-accent px-2.5 py-1 font-semibold text-trauma-accent-ink hover:opacity-90"
          onClick={jumpToLastPosition}
        >
          <span>Jump to last spot</span>
        </button>
        <button
          type="button"
          aria-label="Dismiss resumption cue"
          class="rounded-full px-1.5 py-1 text-trauma-text-muted hover:bg-trauma-bg-tint hover:text-trauma-text-primary"
          onClick={() => {
            clearHighlights();
            setDismissed(true);
          }}
        >
          ×
        </button>
        <Show when={statusNote() !== ""}>
          <span class="text-[11px] text-trauma-text-muted" aria-live="polite">
            {statusNote()}
          </span>
        </Show>
      </div>
    </Show>
  );
}

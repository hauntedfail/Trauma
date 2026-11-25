import { For, Show, createMemo, createSignal } from "solid-js";

import { useFocusPlugins } from "../context";
import { ADAPTIVE_AI_PRESENTER_PLUGIN_ID } from "./definitions";

export interface AdaptedBulletItem {
  readonly anchor?: string;
  readonly body: string;
}

export interface RestructuredAiResponse {
  readonly shouldAdapt: boolean;
  readonly tldr: string;
  readonly bullets: readonly AdaptedBulletItem[];
}

function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/(?<=[.!?。！？])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function extractAnchor(point: string): AdaptedBulletItem {
  const cleaned = point.replace(/^(?:[-*•]|\d+[.)])\s+/, "").trim();
  const boldLead = cleaned.match(/^\*\*([^*]{2,48})\*\*\s*[:：-]?\s*(.+)$/);
  if (boldLead) {
    return { anchor: boldLead[1]!.trim(), body: boldLead[2]!.trim() };
  }
  const colonLead = cleaned.match(/^([^:：]{2,40})[:：]\s+(.+)$/);
  if (colonLead) {
    return { anchor: colonLead[1]!.trim(), body: colonLead[2]!.trim() };
  }
  return { body: cleaned };
}

export function restructureAiResponse(text: string): RestructuredAiResponse {
  const trimmed = text.trim();
  if (!trimmed) {
    return { shouldAdapt: false, tldr: "", bullets: [] };
  }

  const lines = trimmed
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const bulletLines = lines.filter((line) => /^([-*•]|\d+[.)])\s+/.test(line));
  const proseLines = lines.filter((line) => !/^([-*•]|\d+[.)])\s+/.test(line));

  if (bulletLines.length >= 2) {
    const tldr = proseLines[0] ?? bulletLines[0]!.replace(/^([-*•]|\d+[.)])\s+/, "");
    return {
      shouldAdapt: true,
      tldr,
      bullets: bulletLines.map(extractAnchor),
    };
  }

  const sentences = splitSentences(trimmed);
  if (sentences.length <= 2 && trimmed.length < 220) {
    return {
      shouldAdapt: false,
      tldr: trimmed,
      bullets: [],
    };
  }

  const [first, ...rest] = sentences;
  return {
    shouldAdapt: true,
    tldr: first ?? trimmed,
    bullets: rest.map(extractAnchor),
  };
}

export interface AdaptiveAiResponseProps {
  text: string;
}

export function AdaptiveAiResponse(props: AdaptiveAiResponseProps) {
  const focusPlugins = useFocusPlugins();
  const isEnabled = createMemo(() =>
    focusPlugins.isPluginEnabled(ADAPTIVE_AI_PRESENTER_PLUGIN_ID),
  );
  const defaultView = createMemo<"adapted" | "original">(() => {
    const raw = focusPlugins.getPluginSetting<string>(
      ADAPTIVE_AI_PRESENTER_PLUGIN_ID,
      "defaultView",
    );
    return raw === "original" ? "original" : "adapted";
  });
  const maxBullets = createMemo<number>(() => {
    const raw = focusPlugins.getPluginSetting<number>(
      ADAPTIVE_AI_PRESENTER_PLUGIN_ID,
      "maxBullets",
    );
    return typeof raw === "number" && Number.isFinite(raw) ? raw : 3;
  });
  const highlightAnchors = createMemo<boolean>(() => {
    const raw = focusPlugins.getPluginSetting<boolean>(
      ADAPTIVE_AI_PRESENTER_PLUGIN_ID,
      "highlightAnchors",
    );
    return raw !== false;
  });

  const [overrideMode, setOverrideMode] = createSignal<"adapted" | "original" | null>(
    null,
  );
  const [expanded, setExpanded] = createSignal(false);

  const activeMode = createMemo(() => overrideMode() ?? defaultView());
  const structured = createMemo(() => restructureAiResponse(props.text));
  const visibleBullets = createMemo(() => {
    const all = structured().bullets;
    if (expanded() || all.length <= maxBullets()) {
      return all;
    }
    return all.slice(0, maxBullets());
  });
  const hiddenCount = createMemo(() =>
    Math.max(0, structured().bullets.length - visibleBullets().length),
  );

  return (
    <Show when={isEnabled() && structured().shouldAdapt} fallback={<p>{props.text}</p>}>
      <div class="grid gap-2" data-focus-plugin="adaptive-ai-presenter">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[11px] font-semibold uppercase tracking-[0.06em] text-trauma-text-muted">
            {activeMode() === "adapted" ? "Adapted view" : "Original view"}
          </span>
          <div
            class="inline-flex rounded-full border border-trauma-border bg-trauma-bg-surface p-0.5 text-[11px]"
            role="group"
            aria-label="AI response presentation mode"
          >
            <button
              type="button"
              aria-pressed={activeMode() === "adapted"}
              class={`rounded-full px-2 py-0.5 font-medium transition ${
                activeMode() === "adapted"
                  ? "bg-trauma-accent text-trauma-accent-ink"
                  : "text-trauma-text-secondary hover:text-trauma-text-primary"
              }`}
              onClick={() => setOverrideMode("adapted")}
            >
              Adapted
            </button>
            <button
              type="button"
              aria-pressed={activeMode() === "original"}
              class={`rounded-full px-2 py-0.5 font-medium transition ${
                activeMode() === "original"
                  ? "bg-trauma-accent text-trauma-accent-ink"
                  : "text-trauma-text-secondary hover:text-trauma-text-primary"
              }`}
              onClick={() => setOverrideMode("original")}
            >
              Original
            </button>
          </div>
        </div>

        <Show when={activeMode() === "adapted"} fallback={<p>{props.text}</p>}>
          <div class="grid gap-2">
            <p class="rounded-md border-l-2 border-trauma-accent bg-trauma-bg-surface/70 px-2.5 py-1.5 text-sm font-medium text-trauma-text-primary">
              <span class="mr-1.5 text-[11px] font-bold uppercase tracking-wide text-trauma-accent">
                TL;DR
              </span>
              {structured().tldr}
            </p>
            <Show when={visibleBullets().length > 0}>
              <ul class="grid gap-1.5 pl-4 text-sm text-trauma-text-secondary list-disc">
                <For each={visibleBullets()}>
                  {(item) => (
                    <li>
                      <Show when={highlightAnchors() && item.anchor}>
                        {(anchor) => (
                          <strong class="font-semibold text-trauma-text-primary">
                            {anchor()}:{" "}
                          </strong>
                        )}
                      </Show>
                      <span>{item.body}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={hiddenCount() > 0 || (expanded() && structured().bullets.length > maxBullets())}>
              <button
                type="button"
                class="justify-self-start rounded-md border border-trauma-border px-2 py-0.5 text-xs font-medium text-trauma-text-primary hover:bg-trauma-bg-elev"
                onClick={() => setExpanded((prev) => !prev)}
              >
                {expanded()
                  ? "Show fewer points"
                  : `Show ${hiddenCount()} more ${hiddenCount() === 1 ? "point" : "points"}`}
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}

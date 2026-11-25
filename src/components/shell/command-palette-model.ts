import type {
  BrowseMemory,
  MemoryTriageState,
} from "../memories/browse-data";
import type { FocusPluginDefinition } from "../../plugins/types";

export interface PaletteNavigationItem {
  id: string;
  label: string;
  description: string;
  href: string;
  keywords: readonly string[];
}

export const PALETTE_NAVIGATION_ITEMS: readonly PaletteNavigationItem[] = [
  {
    id: "nav-today",
    label: "Go to Today",
    description: "Picked items for today",
    href: "/memories",
    keywords: ["today", "home", "memories", "daily", "picked"],
  },
  {
    id: "nav-shelf",
    label: "Go to Shelf",
    description: "New and undecided items",
    href: "/memories?lane=shelf",
    keywords: ["shelf", "inbox", "triage", "new", "undecided"],
  },
  {
    id: "nav-library",
    label: "Go to Library",
    description: "Kept and finished items",
    href: "/memories?lane=library",
    keywords: ["library", "saved", "kept", "archive", "search"],
  },
  {
    id: "nav-flashbacks",
    label: "Go to Flashbacks",
    description: "Highlighted passages",
    href: "/flashbacks",
    keywords: ["flashbacks", "highlights", "quotes"],
  },
  {
    id: "nav-moments",
    label: "Go to Moments",
    description: "Saved bookmarks and moments",
    href: "/moments",
    keywords: ["moments", "bookmarks"],
  },
  {
    id: "nav-settings",
    label: "Go to Settings",
    description: "App and focus plugin settings",
    href: "/settings",
    keywords: ["settings", "preferences", "focus", "plugins", "config"],
  },
] as const;

export interface PaletteLaneMoveTarget {
  state: MemoryTriageState;
  label: string;
  description: string;
  keywords: readonly string[];
}

export const PALETTE_LANE_MOVE_TARGETS: readonly PaletteLaneMoveTarget[] = [
  {
    state: "today",
    label: "Move to Today",
    description: "Pick focused memory for Today",
    keywords: ["move", "pick", "today", "lane", "triage"],
  },
  {
    state: "shelf",
    label: "Move to Shelf",
    description: "Return focused memory to Shelf",
    keywords: ["move", "shelf", "return", "not now", "lane", "triage"],
  },
  {
    state: "library",
    label: "Move to Library",
    description: "Keep focused memory in Library",
    keywords: ["move", "keep", "library", "lane", "triage"],
  },
  {
    state: "archive",
    label: "Move to Archive",
    description: "Archive focused memory",
    keywords: ["move", "archive", "lane", "triage"],
  },
] as const;

export type CommandPaletteItem =
  | {
      id: string;
      section: "Capture";
      kind: "capture-url";
      label: string;
      description: string;
      url: string;
    }
  | {
      id: string;
      section: "Memories";
      kind: "memory";
      label: string;
      description: string;
      memoryId: string;
      href: string;
    }
  | {
      id: string;
      section: "Actions";
      kind: "open-capture";
      label: string;
      description: string;
    }
  | {
      id: string;
      section: "Navigation";
      kind: "navigate";
      label: string;
      description: string;
      href: string;
    }
  | {
      id: string;
      section: "Focused memory";
      kind: "move-lane";
      label: string;
      description: string;
      memoryId: string;
      triageState: MemoryTriageState;
    }
  | {
      id: string;
      section: "Focus plugins";
      kind: "toggle-plugin";
      label: string;
      description: string;
      pluginId: string;
      enabled: boolean;
    };

export type CaptureUrlValidationResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export function validateCaptureUrl(raw: string): CaptureUrlValidationResult {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return {
      ok: false,
      error: "Enter a URL before saving.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      error: "Enter a valid http:// or https:// URL.",
    };
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.hostname.trim() === ""
  ) {
    return {
      ok: false,
      error: "Enter a valid http:// or https:// URL.",
    };
  }

  return {
    ok: true,
    url: trimmed,
  };
}

export function looksLikeCaptureUrl(raw: string): boolean {
  return /^https?:\/\//i.test(raw.trim());
}

export function isCommandPaletteShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">,
): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    event.key.toLowerCase() === "k"
  );
}

export function extractMemoryIdFromPathname(pathname: string): string | null {
  if (!pathname.startsWith("/memories/")) {
    return null;
  }

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  const rawId = segments.length >= 3 ? segments[2] : segments[1];
  if (rawId === undefined || rawId.trim() === "") {
    return null;
  }

  try {
    return decodeURIComponent(rawId);
  } catch {
    return rawId;
  }
}

export function extractFocusedMemoryId(
  pathname: string,
  activeElement: Element | null | undefined,
): string | null {
  const fromPath = extractMemoryIdFromPathname(pathname);
  if (fromPath !== null) {
    return fromPath;
  }

  if (activeElement == null) {
    return null;
  }

  const memoryContainer = activeElement.closest("[data-memory-id]");
  const dataId = memoryContainer?.getAttribute("data-memory-id")?.trim();
  if (dataId !== undefined && dataId !== "") {
    return dataId;
  }

  const anchor = activeElement.closest("a[href]");
  const href = anchor?.getAttribute("href");
  if (href !== null && href !== undefined) {
    try {
      const parsed = new URL(href, "http://trauma.local");
      const fromHref = extractMemoryIdFromPathname(parsed.pathname);
      if (fromHref !== null) {
        return fromHref;
      }
    } catch {
      // Ignore malformed hrefs.
    }
  }

  return null;
}

export interface BuildCommandPaletteItemsInput {
  query: string;
  searchResults: readonly BrowseMemory[];
  focusedMemoryId: string | null;
  plugins: readonly FocusPluginDefinition[];
  isPluginEnabled: (pluginId: string) => boolean;
}

export function buildCommandPaletteItems(
  input: BuildCommandPaletteItemsInput,
): CommandPaletteItem[] {
  const trimmed = input.query.trim();
  const needle = trimmed.toLowerCase();
  const items: CommandPaletteItem[] = [];

  if (looksLikeCaptureUrl(trimmed)) {
    items.push({
      id: "capture-direct-url",
      section: "Capture",
      kind: "capture-url",
      label: `Capture URL: ${trimmed}`,
      description: "Save directly to Shelf without taxonomy",
      url: trimmed,
    });
  }

  for (const memory of input.searchResults) {
    items.push({
      id: `memory-${memory.id}`,
      section: "Memories",
      kind: "memory",
      label: memory.title || memory.url,
      description: formatMemoryHost(memory.url),
      memoryId: memory.id,
      href: `/memories/${encodeURIComponent(memory.id)}`,
    });
  }

  const captureActionMatches =
    needle === "" ||
    matchesNeedle(needle, [
      "add url",
      "capture",
      "save url",
      "add memory",
      "new memory",
    ]);
  if (captureActionMatches) {
    items.push({
      id: "action-open-capture",
      section: "Actions",
      kind: "open-capture",
      label: "Add URL",
      description: "Capture a link directly to Shelf",
    });
  }

  if (input.focusedMemoryId !== null) {
    for (const target of PALETTE_LANE_MOVE_TARGETS) {
      if (
        needle === "" ||
        matchesNeedle(needle, [target.label, target.description, ...target.keywords])
      ) {
        items.push({
          id: `move-${target.state}`,
          section: "Focused memory",
          kind: "move-lane",
          label: target.label,
          description: target.description,
          memoryId: input.focusedMemoryId,
          triageState: target.state,
        });
      }
    }
  }

  for (const nav of PALETTE_NAVIGATION_ITEMS) {
    if (
      needle === "" ||
      matchesNeedle(needle, [nav.label, nav.description, ...nav.keywords])
    ) {
      items.push({
        id: nav.id,
        section: "Navigation",
        kind: "navigate",
        label: nav.label,
        description: nav.description,
        href: nav.href,
      });
    }
  }

  for (const plugin of input.plugins) {
    if (
      needle === "" ||
      matchesNeedle(needle, [
        plugin.name,
        plugin.id,
        plugin.description,
        "plugin",
        "focus",
        "toggle",
      ])
    ) {
      const enabled = input.isPluginEnabled(plugin.id);
      items.push({
        id: `plugin-${plugin.id}`,
        section: "Focus plugins",
        kind: "toggle-plugin",
        label: `Toggle ${plugin.name}`,
        description: plugin.description,
        pluginId: plugin.id,
        enabled,
      });
    }
  }

  return items;
}

export type TriageMoveResult =
  | { ok: true; triageState: MemoryTriageState }
  | { ok: false; error: string };

export async function submitMemoryTriageMove(input: {
  memoryId: string;
  triageState: MemoryTriageState;
  todayCap?: number | null;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<TriageMoveResult> {
  const fetcher = input.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetcher(
      `/api/memories/${encodeURIComponent(input.memoryId)}/triage`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          triage_state: input.triageState,
          ...(input.todayCap !== undefined ? { todayCap: input.todayCap } : {}),
        }),
      },
    );
  } catch {
    return {
      ok: false,
      error: "Could not move memory. Check your connection and try again.",
    };
  }

  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await response.json();
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    body = null;
  }

  if (!response.ok) {
    const serverError =
      typeof body?.error === "string" && body.error.trim() !== ""
        ? body.error
        : `Could not move memory (${response.status}).`;
    return {
      ok: false,
      error: serverError,
    };
  }

  return {
    ok: true,
    triageState: input.triageState,
  };
}

function matchesNeedle(needle: string, haystack: readonly string[]): boolean {
  const terms = needle.split(/\s+/).filter(Boolean);
  const combined = haystack.join(" ").toLowerCase();
  return terms.every((term) => combined.includes(term));
}

function formatMemoryHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

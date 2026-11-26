import { useNavigate } from "@solidjs/router";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type JSX,
} from "solid-js";

import { useFocusPlugins } from "../../plugins";
import { PlusIcon, SearchIcon } from "../icons";
import { TraumaDialog } from "../ui/Dialog";
import type { AddMemorySubmissionController } from "../memories/add-memory-controller";
import {
  defaultBrowseQuery,
  type BrowseMemory,
} from "../memories/browse-data";
import {
  getBrowseMemoryPage,
  revalidateBrowseMemoryWorkspace,
} from "../memories/browse-loader";
import {
  buildCommandPaletteItems,
  looksLikeCaptureUrl,
  OPEN_READER_PSYCHIATRIST_EVENT,
  submitMemoryTriageMove,
  validateCaptureUrl,
  type CommandPaletteItem,
} from "./command-palette-model";

export interface CommandPaletteProps {
  open: boolean;
  initialMode?: "search" | "capture";
  focusedMemoryId: string | null;
  isReaderRoute: boolean;
  addMemorySubmission: AddMemorySubmissionController;
  onClose: (restoreFocus: boolean) => void;
}

const SEARCH_DEBOUNCE_MS = 140;
const PALETTE_SEARCH_LIMIT = 8;

export function CommandPalette(props: CommandPaletteProps) {
  const navigate = useNavigate();
  const focusPlugins = useFocusPlugins();

  const [mode, setMode] = createSignal<"search" | "capture">("search");
  const [query, setQuery] = createSignal("");
  const [searchResults, setSearchResults] = createSignal<BrowseMemory[]>([]);
  const [isSearching, setIsSearching] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [errorMessage, setErrorMessage] = createSignal("");
  const [statusMessage, setStatusMessage] = createSignal("");
  const [isBusy, setIsBusy] = createSignal(false);

  let dialogRef: HTMLDivElement | undefined;
  let searchInputRef: HTMLInputElement | undefined;
  let captureInputRef: HTMLInputElement | undefined;
  let searchSequence = 0;
  let paletteSessionId = 0;
  let pendingPsychiatristTimer: number | undefined;

  onCleanup(() => {
    if (pendingPsychiatristTimer !== undefined) {
      window.clearTimeout(pendingPsychiatristTimer);
      pendingPsychiatristTimer = undefined;
    }
  });

  const items = createMemo(() =>
    buildCommandPaletteItems({
      query: query(),
      searchResults: searchResults(),
      focusedMemoryId: props.focusedMemoryId,
      isReaderRoute: props.isReaderRoute,
      plugins: focusPlugins.plugins(),
      isPluginEnabled: (pluginId) => focusPlugins.isPluginEnabled(pluginId),
    }),
  );

  const groupedItems = createMemo(() => {
    const groups: Array<{
      section: CommandPaletteItem["section"];
      entries: Array<{ item: CommandPaletteItem; index: number }>;
    }> = [];
    const bySection = new Map<
      CommandPaletteItem["section"],
      Array<{ item: CommandPaletteItem; index: number }>
    >();

    items().forEach((item, index) => {
      let bucket = bySection.get(item.section);
      if (bucket === undefined) {
        bucket = [];
        bySection.set(item.section, bucket);
        groups.push({ section: item.section, entries: bucket });
      }
      bucket.push({ item, index });
    });

    return groups;
  });

  const activeItem = createMemo(() => {
    const list = items();
    if (list.length === 0) {
      return undefined;
    }
    const clamped = Math.min(Math.max(activeIndex(), 0), list.length - 1);
    return list[clamped];
  });

  createEffect(() => {
    paletteSessionId += 1;
    if (!props.open) {
      return;
    }

    const nextMode = props.initialMode ?? "search";
    setMode(nextMode);
    setQuery("");
    setSearchResults([]);
    setIsSearching(false);
    setActiveIndex(0);
    setErrorMessage("");
    setStatusMessage("");
    setIsBusy(false);

    queueMicrotask(() => {
      if (nextMode === "capture") {
        captureInputRef?.focus({ preventScroll: true });
      } else {
        searchInputRef?.focus({ preventScroll: true });
      }
    });
  });

  createEffect(() => {
    if (!props.open || mode() !== "search") {
      return;
    }

    const trimmed = query().trim();
    if (trimmed === "" || looksLikeCaptureUrl(trimmed)) {
      searchSequence += 1;
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const sequence = ++searchSequence;
    setIsSearching(true);
    const timer = window.setTimeout(() => {
      void getBrowseMemoryPage({
        query: {
          ...defaultBrowseQuery,
          q: trimmed,
        },
        cursor: null,
        limit: PALETTE_SEARCH_LIMIT,
      })
        .then((page) => {
          if (sequence !== searchSequence) {
            return;
          }
          setSearchResults(page.memories);
          setActiveIndex(0);
        })
        .catch(() => {
          if (sequence !== searchSequence) {
            return;
          }
          setSearchResults([]);
        })
        .finally(() => {
          if (sequence === searchSequence) {
            setIsSearching(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    onCleanup(() => {
      window.clearTimeout(timer);
    });
  });

  const listFocusableElements = (): HTMLElement[] => {
    if (dialogRef === undefined) {
      return [];
    }
    return Array.from(
      dialogRef.querySelectorAll<HTMLElement>(
        'a[href], area[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.hasAttribute("disabled") && element.tabIndex >= 0);
  };

  createEffect(() => {
    if (!props.open) {
      return;
    }

    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        props.onClose(true);
        return;
      }

      if (event.key === "Tab") {
        const focusables = listFocusableElements();
        if (focusables.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (event.shiftKey) {
          if (
            active === null ||
            dialogRef === undefined ||
            !dialogRef.contains(active) ||
            active === first
          ) {
            event.preventDefault();
            last.focus({ preventScroll: true });
          }
        } else if (
          active === null ||
          dialogRef === undefined ||
          !dialogRef.contains(active) ||
          active === last
        ) {
          event.preventDefault();
          first.focus({ preventScroll: true });
        }
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown, true);
    onCleanup(() => {
      document.removeEventListener("keydown", handleGlobalKeyDown, true);
    });
  });

  // The shell-owned controller keeps the URL draft and the pending attempt, so
  // closing and reopening the palette shows the same capture state.
  const isSaving = () => isBusy() || props.addMemorySubmission.isSubmitting();
  const captureError = () =>
    errorMessage() !== "" ? errorMessage() : props.addMemorySubmission.errorMessage();

  const switchToCaptureMode = () => {
    setMode("capture");
    setErrorMessage("");
    setStatusMessage("");
    queueMicrotask(() => {
      captureInputRef?.focus({ preventScroll: true });
    });
  };

  const submitCaptureUrl = async (rawUrl: string) => {
    const validated = validateCaptureUrl(rawUrl);
    if (!validated.ok) {
      setErrorMessage(validated.error);
      return;
    }

    if (props.addMemorySubmission.isSubmitting()) {
      return;
    }

    const sessionId = paletteSessionId;
    setErrorMessage("");
    setStatusMessage("");
    setIsBusy(true);
    const view = props.addMemorySubmission.createView();
    try {
      props.addMemorySubmission.setUrl(validated.url);
      let createdMemoryId: string | null = null;
      const result = await view.submit({
        onCreated: (memoryId) => {
          createdMemoryId = memoryId;
        },
      });
      if (sessionId !== paletteSessionId || !props.open) {
        return;
      }
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      const targetId = createdMemoryId ?? result.memoryId;
      props.onClose(false);
      navigate(`/memories/${encodeURIComponent(targetId)}`);
    } finally {
      view.dispose();
      if (sessionId === paletteSessionId) {
        setIsBusy(false);
      }
    }
  };

  const executeItem = async (item: CommandPaletteItem) => {
    setErrorMessage("");
    setStatusMessage("");

    switch (item.kind) {
      case "capture-url":
        await submitCaptureUrl(item.url);
        return;
      case "open-capture":
        switchToCaptureMode();
        return;
      case "open-psychiatrist":
        props.onClose(false);
        if (typeof window !== "undefined") {
          if (pendingPsychiatristTimer !== undefined) {
            window.clearTimeout(pendingPsychiatristTimer);
          }
          pendingPsychiatristTimer = window.setTimeout(() => {
            pendingPsychiatristTimer = undefined;
            window.dispatchEvent(new CustomEvent(OPEN_READER_PSYCHIATRIST_EVENT));
          }, 0);
        }
        return;
      case "memory":
      case "navigate":
        props.onClose(false);
        navigate(item.href);
        return;
      case "toggle-plugin": {
        focusPlugins.togglePlugin(item.pluginId);
        const nowEnabled = focusPlugins.isPluginEnabled(item.pluginId);
        setStatusMessage(
          `${item.label.replace(/^Toggle /, "")} ${nowEnabled ? "enabled" : "disabled"}.`,
        );
        return;
      }
      case "move-lane": {
        const sessionId = paletteSessionId;
        setIsBusy(true);
        try {
          const todayCapEnabled = focusPlugins.isPluginEnabled(
            "ephemeral-shelf-triage",
          );
          const rawCap = todayCapEnabled
            ? focusPlugins.getPluginSetting<number>(
                "ephemeral-shelf-triage",
                "dailyPickCap",
              )
            : undefined;
          const todayCap =
            item.triageState === "today"
              ? typeof rawCap === "number"
                ? rawCap
                : null
              : undefined;
          const result = await submitMemoryTriageMove({
            memoryId: item.memoryId,
            triageState: item.triageState,
            todayCap,
          });
          if (sessionId !== paletteSessionId || !props.open) {
            return;
          }
          if (!result.ok) {
            setErrorMessage(result.error);
            return;
          }
          await revalidateBrowseMemoryWorkspace();
          if (sessionId !== paletteSessionId || !props.open) {
            return;
          }
          props.onClose(true);
        } finally {
          if (sessionId === paletteSessionId) {
            setIsBusy(false);
          }
        }
        return;
      }
    }
  };

  const handleSearchKeyDown: JSX.EventHandler<HTMLInputElement, KeyboardEvent> = (
    event,
  ) => {
    const list = items();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (list.length > 0) {
        setActiveIndex((prev) => (prev + 1) % list.length);
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (list.length > 0) {
        setActiveIndex((prev) => (prev - 1 + list.length) % list.length);
      }
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      if (list.length > 0) {
        setActiveIndex(list.length - 1);
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const current = activeItem();
      if (current !== undefined && !isBusy()) {
        void executeItem(current);
      }
    }
  };

  const handleCaptureSubmit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (
    event,
  ) => {
    event.preventDefault();
    if (!isSaving()) {
      void submitCaptureUrl(props.addMemorySubmission.url());
    }
  };

  return (
    <TraumaDialog
      ariaLabel="Command palette"
      contentClass="max-w-[560px]"
      contentRef={(el) => {
        dialogRef = el;
      }}
      id="trauma-command-palette"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          props.onClose(true);
        }
      }}
      open={props.open}
    >
      <Show
            when={mode() === "search"}
            fallback={
              <form
                aria-label="Capture URL"
                class="grid gap-3 p-4"
                noValidate
                onSubmit={handleCaptureSubmit}
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <PlusIcon size={18} />
                    <h2 class="mb-0 text-base font-bold">Capture URL</h2>
                  </div>
                  <button
                    class="trauma-control trauma-control-compact trauma-control-quiet"
                    type="button"
                    onClick={() => {
                      setMode("search");
                      setErrorMessage("");
                      queueMicrotask(() => {
                        searchInputRef?.focus({ preventScroll: true });
                      });
                    }}
                  >
                    Back
                  </button>
                </div>
                <label class="grid gap-1.5">
                  <span class="text-xs font-bold uppercase tracking-wide text-trauma-text-muted">
                    URL
                  </span>
                  <input
                    ref={captureInputRef}
                    aria-invalid={captureError() !== "" ? "true" : undefined}
                    aria-label="URL to capture"
                    class="trauma-field min-h-[42px] w-full text-sm placeholder:text-trauma-text-placeholder"
                    disabled={isSaving()}
                    inputMode="url"
                    placeholder="https://example.com/article"
                    type="text"
                    value={props.addMemorySubmission.url()}
                    onInput={(event) => {
                      props.addMemorySubmission.setUrl(event.currentTarget.value);
                      if (errorMessage() !== "") {
                        setErrorMessage("");
                      }
                    }}
                  />
                </label>
                <Show when={captureError() !== ""}>
                  <p
                    class="mb-0 text-sm font-semibold text-red-700 dark:text-red-400"
                    role="alert"
                  >
                    {captureError()}
                  </p>
                </Show>
                <div class="flex items-center justify-end gap-2 pt-1">
                  <button
                    class="trauma-control trauma-control-quiet"
                    type="button"
                    onClick={() => props.onClose(true)}
                  >
                    Cancel
                  </button>
                  <button
                    class="trauma-control trauma-control-primary"
                    disabled={isSaving()}
                    type="submit"
                  >
                    {isSaving() ? "Saving..." : "Save to Shelf"}
                  </button>
                </div>
              </form>
            }
          >
            <div class="flex items-center gap-2.5 border-b border-trauma-border px-4 py-3">
              <span class="text-trauma-text-muted">
                <SearchIcon size={18} />
              </span>
              <input
                ref={searchInputRef}
                aria-activedescendant={
                  activeItem() ? `palette-option-${activeItem()!.id}` : undefined
                }
                aria-autocomplete="list"
                aria-controls="trauma-command-palette-list"
                aria-expanded="true"
                aria-label="Search memories or run a command"
                class="min-w-0 flex-1 bg-transparent text-sm text-trauma-text-primary placeholder:text-trauma-text-placeholder focus:outline-none"
                placeholder="Search memories, jump to a lane, paste a URL, or toggle focus plugins..."
                role="combobox"
                type="search"
                value={query()}
                onInput={(event) => {
                  setQuery(event.currentTarget.value);
                  setActiveIndex(0);
                  setErrorMessage("");
                }}
                onKeyDown={handleSearchKeyDown}
              />
              <kbd class="rounded border border-trauma-border bg-trauma-bg-sunken px-1.5 py-0.5 text-[11px] font-semibold text-trauma-text-muted">
                Esc
              </kbd>
            </div>

            <Show when={errorMessage() !== ""}>
              <p
                class="mb-0 border-b border-trauma-border bg-red-950/10 px-4 py-2 text-sm font-semibold text-red-700 dark:text-red-400"
                role="alert"
              >
                {errorMessage()}
              </p>
            </Show>

            <Show when={statusMessage() !== ""}>
              <p
                class="mb-0 border-b border-trauma-border px-4 py-1.5 text-xs font-semibold text-trauma-text-secondary"
                role="status"
              >
                {statusMessage()}
              </p>
            </Show>

            <div
              aria-label="Command palette results"
              class="max-h-[min(60vh,26rem)] overflow-y-auto overscroll-contain p-2"
              id="trauma-command-palette-list"
              role="listbox"
            >
              <Show
                when={groupedItems().length > 0}
                fallback={
                  <p class="px-3 py-6 text-center text-sm text-trauma-text-muted">
                    {isSearching()
                      ? "Searching..."
                      : "No matching memories or commands."}
                  </p>
                }
              >
                <For each={groupedItems()}>
                  {(group) => (
                    <div class="mb-2 last:mb-0">
                      <p class="mb-1 px-2.5 pt-1 text-[11px] font-bold uppercase tracking-wide text-trauma-text-muted">
                        {group.section}
                      </p>
                      <For each={group.entries}>
                        {({ item, index }) => {
                          const isSelected = () => activeItem()?.id === item.id;
                          return (
                            <button
                              aria-selected={isSelected()}
                              class={`flex w-full items-center justify-between gap-3 rounded-control px-3 py-2 text-left text-sm transition ${
                                isSelected()
                                  ? "bg-trauma-bg-tint text-trauma-text-primary"
                                  : "text-trauma-text-primary hover:bg-trauma-bg-tint/70"
                              }`}
                              id={`palette-option-${item.id}`}
                              role="option"
                              type="button"
                              onClick={() => void executeItem(item)}
                              onMouseEnter={() => setActiveIndex(index)}
                            >
                              <span class="min-w-0 flex-1">
                                <span class="block truncate font-semibold">
                                  {item.label}
                                </span>
                                <span class="block truncate text-xs text-trauma-text-muted">
                                  {item.description}
                                </span>
                              </span>
                              <Show when={item.kind === "toggle-plugin"}>
                                <span
                                  class={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                                    item.kind === "toggle-plugin" && item.enabled
                                      ? "border-trauma-accent text-trauma-accent"
                                      : "border-trauma-border text-trauma-text-muted"
                                  }`}
                                >
                                  {item.kind === "toggle-plugin" && item.enabled
                                    ? "On"
                                    : "Off"}
                                </span>
                              </Show>
                            </button>
                          );
                        }}
                      </For>
                    </div>
                  )}
                </For>
              </Show>
            </div>

            <div class="flex items-center justify-between border-t border-trauma-border px-4 py-2 text-[11px] text-trauma-text-muted">
              <span>↑↓ Navigate · ↵ Select</span>
              <span>⌘K / Ctrl+K</span>
            </div>
          </Show>
    </TraumaDialog>
  );
}

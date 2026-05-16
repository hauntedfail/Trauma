import { createAsync, useNavigate } from "@solidjs/router";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";

import { ChevronLeftIcon, OpenIcon, TraumaNavIcons } from "../icons";
import type {
  ReaderMomentItem,
  ReaderFlashbackItem,
  ReaderMemoryResult,
  ReaderTaxonomyItem,
} from "../../server/reader/page-data";
import type { ReaderTocEntry } from "../../server/reader/markdown-renderer";
import type { FlashbackBrowseRow } from "../../server/db/repositories";
import { FlashbackShortcutList } from "../flashbacks/FlashbackShortcutList";
import {
  getFlashbackBrowseRows,
  revalidateFlashbackBrowseRows,
} from "../flashbacks/flashbacks-loader";
import { MemoryActionMenu } from "../memories/MemoryActionMenu";
import { MemoryReadStatusControl } from "../memories/MemoryReadStatusControl";
import { revalidateBrowseMemoryWorkspace } from "../memories/browse-loader";
import {
  attachCategoryToMemoryByName,
  deleteMemoryById,
  type FetchFunction,
} from "../memories/memory-action-requests";
import {
  createMomentForSection,
  type ReaderMomentSection,
} from "./moment-requests";
import {
  canStartFlashbackToggle,
  isExplicitFlashbackKeyboardToggle,
} from "./flashback-events";
import { revalidateBackupFailsafeAlert } from "../backup/backup-failsafe-loader";
import { SegmentedToggleButton } from "../ui/SegmentedToggleButton";
import {
  readFlashbackFailure,
  shouldRevalidateBackupFailsafeAfterFlashbackFailure,
} from "./flashback-failure";
import {
  readerArticle,
  readerFrame,
  readerPadding,
  readerStatePanel,
} from "./reader-styles";
import { toSafeReaderSourceHref } from "./source-url";
import { useRightRailContent } from "../shell/right-rail-context";
import { revalidateMomentBrowseRows } from "../moments/moments-loader";
import { revalidateReaderMemory } from "./reader-memory-loader";

interface MemoryReaderProps {
  flashbackRows?: FlashbackBrowseRow[];
  navigate?: (path: string) => void;
  result: ReaderMemoryResult;
}

type ReadyReaderMemoryResult = Extract<ReaderMemoryResult, { status: "ready" }>;
interface ReaderSelectionPayload {
  text: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
}

interface ReaderSelection extends ReaderSelectionPayload {
  range: Range;
}

interface ReaderSelectionMenuState {
  key: string;
  position: ReaderSelectionMenuPosition;
  selection: ReaderSelection;
}

interface ReaderSectionMenuState {
  key: string;
  position: ReaderSelectionMenuPosition;
  section: ReaderMomentSection;
}

interface ReaderSelectionMenuPosition {
  left: number;
  placement: "above" | "below";
  top: number;
}

type ReaderFlashbackOperation = "flashback" | "unflashback";
type ReaderMenuElement = HTMLDivElement | undefined;
interface TocScrollState {
  canScrollDown: boolean;
  canScrollUp: boolean;
}

const noTocScrollState: TocScrollState = {
  canScrollDown: false,
  canScrollUp: false,
};

const readerTocScrollContent =
  "max-h-[min(44vh,24rem)] overflow-y-auto overscroll-contain pr-1";

export function MemoryReader(props: MemoryReaderProps) {
  const readyResult = () =>
    props.result.status === "ready" ? props.result : undefined;
  const stateMessage = () =>
    props.result.status === "ready" ? "" : props.result.message;

  return (
    <Show
      keyed
      when={readyResult()}
      fallback={<ReaderState message={stateMessage()} />}
    >
      {(result) => (
        <ReadyMemoryReader
          flashbackRows={props.flashbackRows}
          navigate={props.navigate}
          result={result}
        />
      )}
    </Show>
  );
}

function ReadyMemoryReader(props: {
  flashbackRows?: FlashbackBrowseRow[];
  navigate?: (path: string) => void;
  result: ReadyReaderMemoryResult;
}) {
  let contentRef: HTMLDivElement | undefined;
  let selectionMenuRef: ReaderMenuElement;
  let sectionMenuRef: ReaderMenuElement;
  let sectionLongPressTimer: number | undefined;
  const navigate = props.navigate ?? useNavigate();
  const sourceUrl = () => props.result.memory.url;
  const sourceHref = () => toSafeReaderSourceHref(sourceUrl());
  const [categories, setCategories] = createSignal([
    ...props.result.memory.categories,
  ]);
  const [moments, setMoments] = createSignal([
    ...props.result.memory.moments,
  ]);
  const [currentFlashbacks, setCurrentFlashbacks] = createSignal([
    ...props.result.memory.flashbacks,
  ]);
  const allFlashbacks = props.flashbackRows === undefined
    ? createAsync(() => getFlashbackBrowseRows())
    : () => props.flashbackRows;
  const [selectionMenu, setSelectionMenu] =
    createSignal<ReaderSelectionMenuState>();
  const [sectionMenu, setSectionMenu] = createSignal<ReaderSectionMenuState>();
  const [pendingMomentKey, setPendingMomentKey] = createSignal("");
  const [pendingSelectionKey, setPendingSelectionKey] = createSignal("");
  const [errorMessage, setErrorMessage] = createSignal("");
  const { setRightRailContent } = useRightRailContent();

  const closeSelectionMenu = () => setSelectionMenu(undefined);
  const closeSectionMenu = () => setSectionMenu(undefined);
  const closeReaderMenus = () => {
    closeSelectionMenu();
    closeSectionMenu();
  };
  createEffect(() => {
    props.result.memory.id;
    setCategories([...props.result.memory.categories]);
    setMoments([...props.result.memory.moments]);
    setCurrentFlashbacks([...props.result.memory.flashbacks]);
    setPendingMomentKey("");
    setPendingSelectionKey("");
    setErrorMessage("");
    closeReaderMenus();
  });
  createEffect(() => {
    setRightRailContent(
      <ReaderRightRailContent
        allFlashbacks={allFlashbacks()}
        currentFlashbacks={currentFlashbacks()}
        moments={moments()}
        memoryId={props.result.memory.id}
        onCreateMoment={(section) => void createMoment(section)}
        onOpenSectionMenu={openSectionMenu}
        pendingMomentKey={pendingMomentKey()}
        toc={props.result.rendered.toc}
      />,
    );
  });

  onCleanup(() => setRightRailContent(undefined));

  onMount(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeReaderMenus();
      }
    };
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        ((selectionMenuRef !== undefined && selectionMenuRef.contains(target)) ||
          (sectionMenuRef !== undefined && sectionMenuRef.contains(target)))
      ) {
        return;
      }

      closeReaderMenus();
    };

    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("scroll", closeReaderMenus, true);
    onCleanup(() => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("scroll", closeReaderMenus, true);
      clearSectionLongPress();
    });
  });
  const openSelectionMenu = () => {
    const selection = readReaderSelection(contentRef);
    if (selection === undefined) {
      closeSelectionMenu();
      return;
    }

    closeSectionMenu();
    setSelectionMenu({
      key: getReaderSelectionKey(selection),
      position: positionReaderSelectionMenu(
        selection.range.getBoundingClientRect(),
        {
          height: window.innerHeight,
          width: window.innerWidth,
        },
      ),
      selection,
    });
  };
  const openSectionMenu = (section: ReaderMomentSection, rect: DOMRect) => {
    closeSelectionMenu();
    setSectionMenu({
      key: getReaderMomentKey(section),
      position: positionReaderSelectionMenu(rect, {
        height: window.innerHeight,
        width: window.innerWidth,
      }),
      section,
    });
  };
  const commitSelectionMenu = () => {
    const menu = selectionMenu();
    if (menu === undefined || contentRef === undefined) {
      return;
    }

    closeSelectionMenu();
    void toggleReaderSelection({
      container: contentRef,
      memoryId: props.result.memory.id,
      pendingSelectionKey: pendingSelectionKey(),
      selection: menu.selection,
      setErrorMessage,
      setPendingSelectionKey,
      onFlashbacksChanged: setCurrentFlashbacks,
      onSuccess: () =>
        revalidateAfterFlashbackToggle(props.result.memory.id),
    });
  };
  const commitSectionMenu = () => {
    const menu = sectionMenu();
    if (menu === undefined) {
      return;
    }

    closeSectionMenu();
    void createMoment(menu.section);
  };
  const handleKeyboardSelectionToggle = (event: KeyboardEvent) => {
    if (!isExplicitFlashbackKeyboardToggle(event)) {
      return;
    }

    event.preventDefault();
    openSelectionMenu();
  };
  const deleteMemory = async (memoryId: string): Promise<void> => {
    await deleteReaderMemory({
      memoryId,
      navigate,
    });
  };
  const attachCategory = async (input: {
    memoryId: string;
    name: string;
  }): Promise<void> => {
    const category = await attachReaderCategoryByName(input);
    setCategories((current) => mergeReaderTaxonomyItem(current, category));
    void Promise.all([
      revalidateBrowseMemoryWorkspace(),
      revalidateReaderMemory(input.memoryId),
    ]);
  };
  const createMoment = async (
    section: ReaderMomentSection,
  ): Promise<void> => {
    const sectionKey = getReaderMomentKey(section);
    if (pendingMomentKey().length > 0) {
      return;
    }

    setErrorMessage("");
    setPendingMomentKey(sectionKey);
    try {
      const result = await createMomentForSection({
        memoryId: props.result.memory.id,
        section,
      });
      setMoments((current) =>
        mergeReaderMomentItem(current, result.moment),
      );
      void revalidateMomentBrowseRows();
    } catch {
      setErrorMessage("Moment failed");
    } finally {
      setPendingMomentKey("");
    }
  };
  const handleReaderContentClick = (event: MouseEvent) => {
    const sectionElement = findReaderSectionElement(event.target, contentRef);
    if (
      sectionElement === undefined ||
      !isSectionMomentClick(event, sectionElement)
    ) {
      return;
    }

    const section = readReaderSection(sectionElement);
    if (section === undefined) {
      return;
    }

    event.preventDefault();
    void createMoment(section);
  };
  const handleReaderContentPointerDown = (event: PointerEvent) => {
    clearSectionLongPress();
    if (event.button !== 0) {
      return;
    }

    const sectionElement = findReaderSectionElement(event.target, contentRef);
    const section = sectionElement === undefined
      ? undefined
      : readReaderSection(sectionElement);
    if (section === undefined || sectionElement === undefined) {
      return;
    }

    sectionLongPressTimer = window.setTimeout(() => {
      openSectionMenu(section, sectionElement.getBoundingClientRect());
    }, 500);
  };
  const clearSectionLongPress = () => {
    if (sectionLongPressTimer === undefined) {
      return;
    }

    window.clearTimeout(sectionLongPressTimer);
    sectionLongPressTimer = undefined;
  };

  return (
    <article class={readerFrame} aria-label="Memory">
      <header class={`${readerPadding} trauma-reader-header sticky top-0 z-[1] grid grid-cols-[42px_minmax(0,1fr)_auto] gap-3 border-b border-trauma-border bg-trauma-bg-surface/95 py-6 backdrop-blur`}>
        <a class="mt-1 grid size-10 place-items-center rounded-full text-trauma-text-muted hover:bg-trauma-bg-elev hover:text-trauma-text-primary" href="/memories" aria-label="Back to memories">
          <ChevronLeftIcon />
        </a>
        <div class="min-w-0">
          <p class="mb-2 text-[20px] font-bold text-trauma-text-primary">Memory</p>
          <Show
            when={sourceHref()}
            fallback={<span class="wrap-anywhere inline-flex items-center gap-1.5 text-sm text-trauma-link"><OpenIcon />{sourceUrl()}</span>}
          >
            {(href) => (
              <a
                class="wrap-anywhere inline-flex items-center gap-1.5 text-sm text-trauma-link hover:text-trauma-link-hover hover:underline"
                href={href()}
                rel="noreferrer"
                target="_blank"
              >
                <OpenIcon />
                {sourceUrl()}
              </a>
            )}
          </Show>
          <ReaderTaxonomyChips
            categories={categories()}
            tags={props.result.memory.tags}
          />
        </div>
        <div class="flex items-start gap-2">
          <MemoryReadStatusControl
            compact
            initialRead={props.result.memory.read}
            memoryId={props.result.memory.id}
            onSaved={() => revalidateAfterReadStatusChange(props.result.memory.id)}
          />
          <MemoryActionMenu
            memoryId={props.result.memory.id}
            memoryTitle={props.result.memory.title}
            onAttachCategoryByName={attachCategory}
            onDelete={deleteMemory}
          />
        </div>
      </header>
      <div class={`${readerPadding} trauma-reader-body py-7 pb-14`}>
        <div class="trauma-fluid-page-shell">
          <div
            ref={contentRef}
            aria-busy={pendingSelectionKey().length > 0}
            class={readerArticle}
            data-reader-content
            innerHTML={props.result.rendered.html}
            onClick={handleReaderContentClick}
            onKeyUp={handleKeyboardSelectionToggle}
            onMouseUp={openSelectionMenu}
            onPointerCancel={clearSectionLongPress}
            onPointerLeave={clearSectionLongPress}
            onPointerMove={clearSectionLongPress}
            onPointerUp={clearSectionLongPress}
            onPointerDown={handleReaderContentPointerDown}
            tabIndex={0}
          />
          <Show when={selectionMenu()}>
            {(menu) => (
              <ReaderContextMenu
                label="Reader text selection actions"
                menuRef={(element) => {
                  selectionMenuRef = element;
                }}
                position={menu().position}
              >
                <button
                  aria-label="Flashback selection"
                  class="grid size-10 place-items-center rounded-full text-trauma-text-primary hover:bg-trauma-bg-tint"
                  disabled={pendingSelectionKey() === menu().key}
                  type="button"
                  onClick={commitSelectionMenu}
                >
                  {TraumaNavIcons.flashbacks.filled({ size: 18 })}
                </button>
              </ReaderContextMenu>
            )}
          </Show>
          <Show when={sectionMenu()}>
            {(menu) => (
              <ReaderContextMenu
                label="Reader section actions"
                menuRef={(element) => {
                  sectionMenuRef = element;
                }}
                position={menu().position}
              >
                <button
                  aria-label="Moment section"
                  class="grid size-10 place-items-center rounded-full text-trauma-text-primary hover:bg-trauma-bg-tint"
                  disabled={pendingMomentKey() === menu().key}
                  type="button"
                  onClick={commitSectionMenu}
                >
                  {TraumaNavIcons.moment.filled({ size: 18 })}
                </button>
              </ReaderContextMenu>
            )}
          </Show>
          <Show when={errorMessage()}>
            {(message) => (
              <p class="mt-4 rounded-lg border border-trauma-danger bg-trauma-bg-elev px-3 py-2 text-sm font-semibold text-trauma-danger" role="status">
                {message()}
              </p>
            )}
          </Show>
        </div>
      </div>
    </article>
  );
}

function ReaderTaxonomyChips(props: {
  categories: ReaderTaxonomyItem[];
  tags: ReaderTaxonomyItem[];
}) {
  return (
    <Show when={props.categories.length + props.tags.length > 0}>
      <div class="mt-4 flex flex-wrap gap-2 text-xs font-bold">
        <For each={props.categories}>
          {(category) => (
            <span class="rounded-full border border-trauma-border bg-trauma-bg-elev px-2.5 py-1 text-trauma-text-secondary">
              {category.name}
            </span>
          )}
        </For>
        <For each={props.tags}>
          {(tag) => (
            <span class="rounded-full border border-trauma-border bg-trauma-bg-elev px-2.5 py-1 text-trauma-text-secondary">
              #{tag.name}
            </span>
          )}
        </For>
      </div>
    </Show>
  );
}

export async function deleteReaderMemory(input: {
  fetch?: FetchFunction;
  memoryId: string;
  navigate: (path: string) => void;
  revalidate?: (memoryId: string) => Promise<void>;
}): Promise<void> {
  await deleteMemoryById({
    memoryId: input.memoryId,
    fetch: input.fetch,
  });
  await (input.revalidate ?? revalidateAfterMemoryDeletion)(input.memoryId);
  input.navigate("/memories");
}

export async function attachReaderCategoryByName(input: {
  fetch?: FetchFunction;
  memoryId: string;
  name: string;
}): Promise<ReaderTaxonomyItem> {
  return attachCategoryToMemoryByName(input);
}

function mergeReaderTaxonomyItem(
  current: ReaderTaxonomyItem[],
  next: ReaderTaxonomyItem,
): ReaderTaxonomyItem[] {
  if (current.some((item) => item.id === next.id)) {
    return current;
  }

  return [...current, next];
}

function mergeReaderMomentItem(
  current: ReaderMomentItem[],
  next: ReaderMomentItem,
): ReaderMomentItem[] {
  if (
    current.some(
      (item) => item.id === next.id || item.sectionAnchor === next.sectionAnchor,
    )
  ) {
    return current.map((item) =>
      item.id === next.id || item.sectionAnchor === next.sectionAnchor
        ? next
        : item,
    );
  }

  return [next, ...current];
}

async function revalidateAfterReadStatusChange(memoryId: string): Promise<void> {
  await Promise.all([
    revalidateBrowseMemoryWorkspace(),
    revalidateReaderMemory(memoryId),
  ]);
}

async function revalidateAfterMemoryDeletion(memoryId: string): Promise<void> {
  await Promise.all([
    revalidateBrowseMemoryWorkspace(),
    revalidateFlashbackBrowseRows(),
    revalidateMomentBrowseRows(),
    revalidateReaderMemory(memoryId),
  ]);
}

async function revalidateAfterFlashbackToggle(memoryId: string): Promise<void> {
  await Promise.all([
    revalidateFlashbackBrowseRows(),
    revalidateReaderMemory(memoryId),
    revalidateBrowseMemoryWorkspace(),
  ]);
}

function ReaderContextMenu(props: {
  children: JSX.Element;
  label: string;
  menuRef: (element: HTMLDivElement) => void;
  position: ReaderSelectionMenuPosition;
}) {
  return (
    <div
      ref={props.menuRef}
      aria-label={props.label}
      class="fixed z-[70] rounded-full border border-trauma-border bg-trauma-bg-elev p-1 shadow-trauma-2"
      role="menu"
      style={{
        left: `${props.position.left}px`,
        top: `${props.position.top}px`,
      }}
    >
      {props.children}
    </div>
  );
}

function ReaderRightRailContent(props: {
  allFlashbacks: FlashbackBrowseRow[] | undefined;
  currentFlashbacks: ReaderFlashbackItem[];
  moments: ReaderMomentItem[];
  memoryId: string;
  onCreateMoment: (section: ReaderMomentSection) => void;
  onOpenSectionMenu: (section: ReaderMomentSection, rect: DOMRect) => void;
  pendingMomentKey: string;
  toc: ReaderTocEntry[];
}) {
  return (
    <div class="grid gap-4">
      <ReaderToc
        moments={props.moments}
        onCreateMoment={props.onCreateMoment}
        onOpenSectionMenu={props.onOpenSectionMenu}
        pendingMomentKey={props.pendingMomentKey}
        toc={props.toc}
      />
      <ReaderFlashbackTabs
        allFlashbacks={props.allFlashbacks}
        currentFlashbacks={props.currentFlashbacks}
        memoryId={props.memoryId}
      />
    </div>
  );
}

export function ReaderFlashbackTabs(props: {
  allFlashbacks: FlashbackBrowseRow[] | undefined;
  currentFlashbacks: ReaderFlashbackItem[];
  initialTab?: "all" | "memory";
  memoryId: string;
}) {
  const [activeTab, setActiveTab] = createSignal<"all" | "memory">(
    props.initialTab ?? "memory",
  );
  const allRows = createMemo(() => props.allFlashbacks ?? []);
  const isLoadingAll = () => props.allFlashbacks === undefined;

  return (
    <section class="rounded-[20px] border border-trauma-border bg-trauma-bg-base p-5">
      <h2 class="mb-3 text-[20px] font-extrabold text-trauma-text-primary">
        Flashbacks
      </h2>
      <div class="mb-4 grid grid-cols-2 gap-1 rounded-full bg-trauma-bg-sunken p-1">
        <SegmentedToggleButton
          active={activeTab() === "memory"}
          onClick={() => setActiveTab("memory")}
        >
          Current
        </SegmentedToggleButton>
        <SegmentedToggleButton
          active={activeTab() === "all"}
          onClick={() => setActiveTab("all")}
        >
          All
        </SegmentedToggleButton>
      </div>
      <Show
        when={activeTab() === "memory"}
        fallback={
          <FlashbackShortcutList
            emptyLabel="No flashbacks yet"
            flashbacks={allRows().map((flashback) => ({
              id: flashback.id,
              href: `/memories/${flashback.memoryId}#${flashback.id}`,
              prefix: flashback.prefix,
              text: flashback.text,
            }))}
            isLoading={isLoadingAll()}
          />
        }
      >
        <FlashbackShortcutList
          emptyLabel="No flashbacks for this memory yet"
          flashbacks={props.currentFlashbacks.map((flashback) => ({
            id: flashback.id,
            href: `#${flashback.id}`,
            prefix: flashback.prefix,
            text: flashback.text,
          }))}
          isLoading={false}
        />
      </Show>
    </section>
  );
}

function getReaderSelectionKey(selection: ReaderSelectionPayload): string {
  return `${selection.startOffset}:${selection.endOffset}:${selection.text}`;
}

function getReaderMomentKey(section: ReaderMomentSection): string {
  return `${section.id}:${section.path}`;
}

function findReaderSectionElement(
  target: EventTarget | null,
  container: HTMLElement | undefined,
): HTMLElement | undefined {
  if (!(target instanceof Element) || container === undefined) {
    return undefined;
  }

  const section = target.closest<HTMLElement>("[data-reader-section-anchor]");
  if (section === null || !container.contains(section)) {
    return undefined;
  }

  return section;
}

function readReaderSection(
  sectionElement: HTMLElement,
): ReaderMomentSection | undefined {
  const id = sectionElement.dataset.readerSectionAnchor;
  const path = sectionElement.dataset.readerSectionPath;
  const title = sectionElement.dataset.readerSectionTitle
    ?? sectionElement.textContent
    ?? "";
  const level = Number.parseInt(
    sectionElement.dataset.readerSectionLevel ?? "",
    10,
  );

  if (
    id === undefined ||
    id.trim() === "" ||
    path === undefined ||
    path.trim() === "" ||
    title.trim() === "" ||
    !Number.isInteger(level)
  ) {
    return undefined;
  }

  return {
    id: id.trim(),
    level,
    path: path.trim(),
    text: title.trim(),
  };
}

function isSectionMomentClick(
  event: MouseEvent,
  sectionElement: HTMLElement,
): boolean {
  const rect = sectionElement.getBoundingClientRect();
  return event.clientX <= rect.left + 32;
}

export function positionReaderSelectionMenu(
  rect: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width">,
  viewport: { height: number; width: number },
): ReaderSelectionMenuPosition {
  const menuWidth = 48;
  const menuHeight = 48;
  const gap = 8;
  const centeredLeft = rect.left + rect.width / 2 - menuWidth / 2;
  const left = clamp(centeredLeft, gap, viewport.width - menuWidth - gap);
  const canPlaceAbove = rect.top >= menuHeight + gap;
  const top = canPlaceAbove
    ? rect.top - menuHeight - gap
    : Math.min(rect.bottom + gap, viewport.height - menuHeight - gap);

  return {
    left,
    top: Math.max(gap, top),
    placement: canPlaceAbove ? "above" : "below",
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ReaderState(props: { message: string }) {
  return (
    <section class={readerFrame} aria-labelledby="reader-state-title">
      <div class={readerStatePanel}>
        <h1 class="mb-2 text-3xl font-bold text-trauma-text-primary" id="reader-state-title">{props.message}</h1>
        <p>Open another memory from the archive.</p>
      </div>
    </section>
  );
}

function ReaderToc(props: {
  moments: ReaderMomentItem[];
  onCreateMoment: (section: ReaderMomentSection) => void;
  onOpenSectionMenu: (section: ReaderMomentSection, rect: DOMRect) => void;
  pendingMomentKey: string;
  toc: ReaderTocEntry[];
}) {
  let scrollRef: HTMLOListElement | undefined;
  const [tocScrollState, setTocScrollState] =
    createSignal<TocScrollState>(noTocScrollState);
  const updateTocScrollHint = () => {
    if (scrollRef === undefined) {
      setTocScrollState(noTocScrollState);
      return;
    }

    const hasOverflow = scrollRef.scrollHeight > scrollRef.clientHeight + 1;
    const canScrollUp = hasOverflow && scrollRef.scrollTop > 1;
    const canScrollDown =
      hasOverflow &&
      scrollRef.scrollTop + scrollRef.clientHeight < scrollRef.scrollHeight - 1;

    setTocScrollState((current) => {
      if (
        current.canScrollDown === canScrollDown &&
        current.canScrollUp === canScrollUp
      ) {
        return current;
      }

      return {
        canScrollDown,
        canScrollUp,
      };
    });
  };

  createEffect(() => {
    props.toc.length;
    queueMicrotask(updateTocScrollHint);
  });

  onMount(() => {
    updateTocScrollHint();
    window.addEventListener("resize", updateTocScrollHint);
    onCleanup(() => window.removeEventListener("resize", updateTocScrollHint));
  });

  return (
    <Show when={props.toc.length > 0}>
      <nav
        class="animate-trauma-pop-bounce relative overflow-hidden rounded-[20px] border border-trauma-border bg-trauma-bg-base p-5 text-sm text-trauma-text-secondary"
        aria-label="Table of contents"
      >
        <h2 class="mb-4 text-[20px] font-extrabold text-trauma-text-primary">
          Contents
        </h2>
        <div class="trauma-toc-scroll-shell">
          <ol
            ref={scrollRef}
            class={`${readerTocScrollContent} m-0 grid gap-2.5 pl-[18px]`}
            onScroll={updateTocScrollHint}
          >
            {props.toc.map((entry) => (
              <ReaderTocEntryRow
                active={props.moments.some(
                  (moment) =>
                    resolveReaderMomentTarget(moment, props.toc)?.id === entry.id,
                )}
                entry={entry}
                onCreateMoment={props.onCreateMoment}
                onOpenSectionMenu={props.onOpenSectionMenu}
                pending={props.pendingMomentKey === getReaderMomentKey(entry)}
              />
            ))}
          </ol>
        </div>
        <Show when={tocScrollState().canScrollUp}>
          <div
            class="trauma-toc-scroll-fade trauma-toc-scroll-fade-top"
            aria-hidden="true"
          />
        </Show>
        <Show when={tocScrollState().canScrollDown}>
          <div
            class="trauma-toc-scroll-fade trauma-toc-scroll-fade-bottom"
            aria-hidden="true"
          />
        </Show>
      </nav>
    </Show>
  );
}

function resolveReaderMomentTarget(
  moment: ReaderMomentItem,
  toc: ReaderTocEntry[],
): ReaderTocEntry | undefined {
  const exact = toc.find((entry) => entry.id === moment.sectionAnchor);
  if (exact !== undefined) {
    return exact;
  }

  const pathMatches = toc.filter((entry) => entry.path === moment.sectionPath);
  return pathMatches.length === 1 ? pathMatches[0] : undefined;
}

function ReaderTocEntryRow(props: {
  active: boolean;
  entry: ReaderTocEntry;
  onCreateMoment: (section: ReaderMomentSection) => void;
  onOpenSectionMenu: (section: ReaderMomentSection, rect: DOMRect) => void;
  pending: boolean;
}) {
  let rowRef: HTMLLIElement | undefined;
  let longPressTimer: number | undefined;
  const clearLongPress = () => {
    if (longPressTimer === undefined) {
      return;
    }

    window.clearTimeout(longPressTimer);
    longPressTimer = undefined;
  };
  const openLongPressMenu = () => {
    if (rowRef === undefined) {
      return;
    }

    props.onOpenSectionMenu(props.entry, rowRef.getBoundingClientRect());
  };

  onCleanup(clearLongPress);

  return (
    <li
      ref={rowRef}
      class="group grid grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-1.5"
      classList={{
        "ml-2.5": props.entry.level === 2,
        "ml-5": props.entry.level === 3,
      }}
      onPointerCancel={clearLongPress}
      onPointerLeave={clearLongPress}
      onPointerMove={clearLongPress}
      onPointerUp={clearLongPress}
      onPointerDown={(event) => {
        clearLongPress();
        if (event.button !== 0) {
          return;
        }

        longPressTimer = window.setTimeout(openLongPressMenu, 500);
      }}
    >
      <button
        aria-label={`Moment ${props.entry.text}`}
        aria-pressed={props.active}
        class="mt-0.5 grid size-5 place-items-center rounded-full text-trauma-text-muted opacity-0 transition hover:bg-trauma-bg-tint hover:text-trauma-text-primary group-hover:opacity-100 aria-pressed:opacity-100 aria-pressed:text-trauma-link"
        disabled={props.pending}
        type="button"
        onClick={(event) => {
          event.preventDefault();
          props.onCreateMoment(props.entry);
        }}
      >
        {props.active
          ? TraumaNavIcons.moment.filled({ size: 14 })
          : TraumaNavIcons.moment.outline({ size: 14 })}
      </button>
      <a class="hover:text-trauma-link" href={`#${props.entry.id}`}>
        {props.entry.text}
      </a>
    </li>
  );
}

async function toggleReaderSelection(input: {
  container: HTMLDivElement;
  memoryId: string;
  onFlashbacksChanged: (flashbacks: ReaderFlashbackItem[]) => void;
  onSuccess: () => Promise<void> | void;
  pendingSelectionKey: string;
  selection: ReaderSelection;
  setErrorMessage: (message: string) => void;
  setPendingSelectionKey: (key: string) => void;
}) {
  if (!canStartFlashbackToggle(input.pendingSelectionKey)) {
    return;
  }

  const selection = input.selection;
  const selectionKey = getReaderSelectionKey(selection);
  const previousHtml = input.container.innerHTML;
  const shouldUnflashback = isRangeFullyMarked(selection.range, input.container);
  const operation: ReaderFlashbackOperation = shouldUnflashback
    ? "unflashback"
    : "flashback";
  input.setErrorMessage("");
  input.setPendingSelectionKey(selectionKey);
  input.container.focus({ preventScroll: true });

  try {
    applyOptimisticFlashback(selection.range, shouldUnflashback, input.container);
    window.getSelection()?.removeAllRanges();

    const response = await fetch("/api/flashbacks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        memoryId: input.memoryId,
        operation,
        selection: toPayload(selection),
      }),
    });

    const failure = await readFlashbackFailure(response);
    if (failure !== undefined) {
      if (shouldRevalidateBackupFailsafeAfterFlashbackFailure(failure)) {
        void revalidateBackupFailsafeAlert();
      }

      throw new Error(failure.message);
    }
    const payload = await readFlashbackToggleSuccess(response);
    input.onFlashbacksChanged(payload.result.flashbacks);
    void Promise.resolve(input.onSuccess()).catch(() => undefined);
  } catch {
    input.container.innerHTML = previousHtml;
    input.setErrorMessage("Flashback failed");
  } finally {
    input.setPendingSelectionKey("");
  }
}

interface ReaderFlashbackToggleSuccess {
  result: {
    flashbacks: ReaderFlashbackItem[];
  };
}

async function readFlashbackToggleSuccess(
  response: Response,
): Promise<ReaderFlashbackToggleSuccess> {
  const payload: unknown = await response.json();
  if (!isReaderFlashbackToggleSuccess(payload)) {
    throw new Error("invalid flashback toggle response");
  }

  return payload;
}

function isReaderFlashbackToggleSuccess(
  value: unknown,
): value is ReaderFlashbackToggleSuccess {
  if (!isRecord(value) || !isRecord(value.result)) {
    return false;
  }

  return Array.isArray(value.result.flashbacks) &&
    value.result.flashbacks.every(isReaderFlashbackItem);
}

function isReaderFlashbackItem(value: unknown): value is ReaderFlashbackItem {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.text === "string" &&
    typeof value.prefix === "string" &&
    typeof value.suffix === "string" &&
    typeof value.startOffset === "number" &&
    typeof value.endOffset === "number" &&
    (value.contentHash === undefined ||
      value.contentHash === null ||
      typeof value.contentHash === "string") &&
    typeof value.createdAt === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readReaderSelection(
  container: HTMLElement | undefined,
): ReaderSelection | undefined {
  if (container === undefined) {
    return undefined;
  }

  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) {
    return undefined;
  }

  const range = selection.getRangeAt(0).cloneRange();
  if (!containsBoundary(container, range.startContainer) || !containsBoundary(container, range.endContainer)) {
    return undefined;
  }

  const text = range.toString();
  if (text.trim().length === 0) {
    return undefined;
  }

  const preSelectionRange = document.createRange();
  preSelectionRange.selectNodeContents(container);
  preSelectionRange.setEnd(range.startContainer, range.startOffset);
  const startOffset = preSelectionRange.toString().length;
  const endOffset = startOffset + text.length;
  const contentText = container.textContent ?? "";

  return {
    range,
    text,
    prefix: readContextBefore(contentText, startOffset),
    suffix: readContextAfter(contentText, endOffset),
    startOffset,
    endOffset,
  };
}

function containsBoundary(container: HTMLElement, node: Node): boolean {
  return node === container || container.contains(node);
}

function readContextBefore(text: string, startOffset: number): string {
  const lineStart = text.lastIndexOf("\n", startOffset - 1) + 1;
  return text.slice(Math.max(lineStart, startOffset - 80), startOffset);
}

function readContextAfter(text: string, endOffset: number): string {
  const lineEnd = text.indexOf("\n", endOffset);
  const contextEnd = lineEnd === -1 ? text.length : lineEnd;
  return text.slice(endOffset, Math.min(contextEnd, endOffset + 80));
}

function isRangeFullyMarked(range: Range, container: HTMLElement): boolean {
  const textNodes = collectIntersectingTextNodes(range, container).filter(
    (node) => (node.nodeValue ?? "").length > 0,
  );
  return (
    textNodes.length > 0 &&
    textNodes.every((node) =>
      node.parentElement?.closest("mark[data-flashback-id]") !== null,
    )
  );
}

function collectIntersectingTextNodes(range: Range, container: HTMLElement): Text[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();

  while (current !== null) {
    if (range.intersectsNode(current)) {
      nodes.push(current as Text);
    }

    current = walker.nextNode();
  }

  return nodes;
}

function applyOptimisticFlashback(
  range: Range,
  shouldUnflashback: boolean,
  container: HTMLElement,
): void {
  if (shouldUnflashback) {
    const placeholder = document.createElement("span");
    const fragment = range.extractContents();
    stripFlashbackElements(fragment);
    placeholder.append(fragment);
    range.insertNode(placeholder);
    liftNodeOutOfFlashbackMarks(placeholder);
    placeholder.replaceWith(...Array.from(placeholder.childNodes));
    container.normalize();
    return;
  }

  const mark = document.createElement("mark");
  mark.dataset.flashbackId = `pending-${Date.now()}`;
  mark.append(range.extractContents());
  range.insertNode(mark);
  container.normalize();
}

function stripFlashbackElements(fragment: DocumentFragment): void {
  for (const mark of [...fragment.querySelectorAll("mark[data-flashback-id]")]) {
    const parent = mark.parentNode;
    if (parent === null) {
      continue;
    }

    while (mark.firstChild !== null) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
  }
}

function liftNodeOutOfFlashbackMarks(node: HTMLElement): void {
  let mark =
    node.parentElement?.closest<HTMLElement>("mark[data-flashback-id]") ?? null;

  while (mark !== null) {
    const liftTarget = directChildContaining(mark, node);
    if (liftTarget === undefined) {
      return;
    }

    liftChildOutOfMark(liftTarget, mark);
    mark =
      node.parentElement?.closest<HTMLElement>("mark[data-flashback-id]") ??
      null;
  }
}

function directChildContaining(
  ancestor: HTMLElement,
  node: Node,
): ChildNode | undefined {
  let current: Node = node;
  while (current.parentNode !== null && current.parentNode !== ancestor) {
    current = current.parentNode;
  }

  return current.parentNode === ancestor ? (current as ChildNode) : undefined;
}

function liftChildOutOfMark(child: ChildNode, mark: HTMLElement): void {
  const parent = mark.parentNode;
  if (parent === null) {
    return;
  }

  const afterMark = mark.cloneNode(false) as HTMLElement;
  let sibling = child.nextSibling;
  while (sibling !== null) {
    const nextSibling = sibling.nextSibling;
    afterMark.append(sibling);
    sibling = nextSibling;
  }

  parent.insertBefore(child, mark.nextSibling);
  if (afterMark.hasChildNodes()) {
    parent.insertBefore(afterMark, child.nextSibling);
  }

  if (!mark.hasChildNodes()) {
    mark.remove();
  }
}

function toPayload(selection: ReaderSelection): ReaderSelectionPayload {
  return {
    text: selection.text,
    prefix: selection.prefix,
    suffix: selection.suffix,
    startOffset: selection.startOffset,
    endOffset: selection.endOffset,
  };
}

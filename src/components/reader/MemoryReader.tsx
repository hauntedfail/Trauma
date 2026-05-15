import { createAsync, useNavigate } from "@solidjs/router";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

import { ChevronLeftIcon, OpenIcon, TraumaNavIcons } from "../icons";
import type {
  ReaderHighlightItem,
  ReaderMemoryResult,
  ReaderTaxonomyItem,
} from "../../server/reader/page-data";
import type { ReaderTocEntry } from "../../server/reader/markdown-renderer";
import type { HighlightBrowseRow } from "../../server/db/repositories";
import { HighlightExcerpt } from "../highlights/HighlightExcerpt";
import { getHighlightBrowseRows } from "../highlights/highlights-loader";
import { MemoryActionMenu } from "../memories/MemoryActionMenu";
import { MemoryReadStatusControl } from "../memories/MemoryReadStatusControl";
import {
  attachCategoryToMemoryByName,
  deleteMemoryById,
  type FetchFunction,
} from "../memories/memory-action-requests";
import {
  canStartHighlightToggle,
  isExplicitHighlightKeyboardToggle,
} from "./highlight-events";
import { revalidateBackupFailsafeAlert } from "../backup/backup-failsafe-loader";
import {
  readHighlightFailure,
  shouldRevalidateBackupFailsafeAfterHighlightFailure,
} from "./highlight-failure";
import {
  readerArticle,
  readerFrame,
  readerPadding,
  readerStatePanel,
} from "./reader-styles";
import { toSafeReaderSourceHref } from "./source-url";
import { useRightRailContent } from "../shell/right-rail-context";

interface MemoryReaderProps {
  highlightRows?: HighlightBrowseRow[];
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

interface ReaderSelectionMenuPosition {
  left: number;
  placement: "above" | "below";
  top: number;
}

type ReaderHighlightOperation = "highlight" | "unhighlight";
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
          highlightRows={props.highlightRows}
          navigate={props.navigate}
          result={result}
        />
      )}
    </Show>
  );
}

function ReadyMemoryReader(props: {
  highlightRows?: HighlightBrowseRow[];
  navigate?: (path: string) => void;
  result: ReadyReaderMemoryResult;
}) {
  let contentRef: HTMLDivElement | undefined;
  let selectionMenuRef: HTMLDivElement | undefined;
  const navigate = props.navigate ?? useNavigate();
  const sourceUrl = () => props.result.memory.url;
  const sourceHref = () => toSafeReaderSourceHref(sourceUrl());
  const [categories, setCategories] = createSignal([
    ...props.result.memory.categories,
  ]);
  const allHighlights = props.highlightRows === undefined
    ? createAsync(() => getHighlightBrowseRows())
    : () => props.highlightRows;
  const [selectionMenu, setSelectionMenu] =
    createSignal<ReaderSelectionMenuState>();
  const [pendingSelectionKey, setPendingSelectionKey] = createSignal("");
  const [errorMessage, setErrorMessage] = createSignal("");
  const { setRightRailContent } = useRightRailContent();

  createEffect(() => {
    setRightRailContent(
      <ReaderRightRailContent
        allHighlights={allHighlights()}
        currentHighlights={props.result.memory.highlights}
        memoryId={props.result.memory.id}
        toc={props.result.rendered.toc}
      />,
    );
  });

  onCleanup(() => setRightRailContent(undefined));

  onMount(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeSelectionMenu();
      }
    };
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        selectionMenuRef !== undefined &&
        selectionMenuRef.contains(target)
      ) {
        return;
      }

      closeSelectionMenu();
    };

    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("scroll", closeSelectionMenu, true);
    onCleanup(() => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("scroll", closeSelectionMenu, true);
    });
  });

  const closeSelectionMenu = () => setSelectionMenu(undefined);
  const openSelectionMenu = () => {
    const selection = readReaderSelection(contentRef);
    if (selection === undefined) {
      closeSelectionMenu();
      return;
    }

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
    });
  };
  const handleKeyboardSelectionToggle = (event: KeyboardEvent) => {
    if (!isExplicitHighlightKeyboardToggle(event)) {
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
            onKeyUp={handleKeyboardSelectionToggle}
            onMouseUp={openSelectionMenu}
            tabIndex={0}
          />
          <Show when={selectionMenu()}>
            {(menu) => (
              <div
                ref={selectionMenuRef}
                class="fixed z-[70] rounded-full border border-trauma-border bg-trauma-bg-elev p-1 shadow-trauma-2"
                role="menu"
                style={{
                  left: `${menu().position.left}px`,
                  top: `${menu().position.top}px`,
                }}
              >
                <button
                  aria-label="Highlight selection"
                  class="grid size-10 place-items-center rounded-full text-trauma-text-primary hover:bg-trauma-bg-tint"
                  disabled={pendingSelectionKey() === menu().key}
                  type="button"
                  onClick={commitSelectionMenu}
                >
                  {TraumaNavIcons.highlights.filled({ size: 18 })}
                </button>
              </div>
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
}): Promise<void> {
  await deleteMemoryById({
    memoryId: input.memoryId,
    fetch: input.fetch,
  });
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

function ReaderRightRailContent(props: {
  allHighlights: HighlightBrowseRow[] | undefined;
  currentHighlights: ReaderHighlightItem[];
  memoryId: string;
  toc: ReaderTocEntry[];
}) {
  return (
    <div class="grid gap-4">
      <ReaderToc toc={props.toc} />
      <ReaderHighlightTabs
        allHighlights={props.allHighlights}
        currentHighlights={props.currentHighlights}
        memoryId={props.memoryId}
      />
    </div>
  );
}

export function ReaderHighlightTabs(props: {
  allHighlights: HighlightBrowseRow[] | undefined;
  currentHighlights: ReaderHighlightItem[];
  initialTab?: "all" | "memory";
  memoryId: string;
}) {
  const [activeTab, setActiveTab] = createSignal<"all" | "memory">(
    props.initialTab ?? (props.currentHighlights.length > 0 ? "memory" : "all"),
  );
  const allRows = createMemo(() => props.allHighlights ?? []);
  const isLoadingAll = () => props.allHighlights === undefined;

  return (
    <section class="rounded-[20px] border border-trauma-border bg-trauma-bg-base p-5">
      <h2 class="mb-3 text-[20px] font-extrabold text-trauma-text-primary">
        Highlights
      </h2>
      <div class="mb-4 grid grid-cols-2 gap-1 rounded-full bg-trauma-bg-sunken p-1">
        <ReaderHighlightTabButton
          active={activeTab() === "all"}
          label="All highlights"
          onClick={() => setActiveTab("all")}
        />
        <ReaderHighlightTabButton
          active={activeTab() === "memory"}
          label="This memory"
          onClick={() => setActiveTab("memory")}
        />
      </div>
      <Show
        when={activeTab() === "memory"}
        fallback={
          <ReaderHighlightList
            emptyLabel="No highlights yet"
            highlights={allRows()}
            isLoading={isLoadingAll()}
            linkFor={(highlight) =>
              "memoryId" in highlight
                ? `/memories/${highlight.memoryId}#${highlight.id}`
                : `#${highlight.id}`
            }
          />
        }
      >
        <ReaderHighlightList
          emptyLabel="No highlights for this memory yet"
          highlights={props.currentHighlights}
          isLoading={false}
          linkFor={(highlight) => `#${highlight.id}`}
        />
      </Show>
    </section>
  );
}

function ReaderHighlightTabButton(props: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={props.active}
      class="min-h-9 rounded-full px-3 text-sm font-extrabold text-trauma-text-secondary hover:bg-trauma-bg-tint aria-pressed:bg-trauma-bg-elev aria-pressed:text-trauma-text-primary"
      type="button"
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

function ReaderHighlightList(props: {
  emptyLabel: string;
  highlights: Array<ReaderHighlightItem | HighlightBrowseRow>;
  isLoading: boolean;
  linkFor: (highlight: ReaderHighlightItem | HighlightBrowseRow) => string;
}) {
  return (
    <Show
      when={!props.isLoading}
      fallback={<p class="mb-0 text-sm font-bold text-trauma-text-muted">Loading highlights...</p>}
    >
      <Show
        when={props.highlights.length > 0}
        fallback={<p class="mb-0 text-sm font-bold text-trauma-text-muted">{props.emptyLabel}</p>}
      >
        <div class="grid gap-3">
          <For each={props.highlights}>
            {(highlight) => (
              <HighlightExcerpt
                href={props.linkFor(highlight)}
                prefix={highlight.prefix}
                suffix={highlight.suffix}
                text={highlight.text}
              />
            )}
          </For>
        </div>
      </Show>
    </Show>
  );
}

function getReaderSelectionKey(selection: ReaderSelectionPayload): string {
  return `${selection.startOffset}:${selection.endOffset}:${selection.text}`;
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

function ReaderToc(props: { toc: ReaderTocEntry[] }) {
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
              <li
                classList={{
                  "ml-2.5": entry.level === 2,
                  "ml-5": entry.level === 3,
                }}
              >
                <a class="hover:text-trauma-link" href={`#${entry.id}`}>
                  {entry.text}
                </a>
              </li>
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

async function toggleReaderSelection(input: {
  container: HTMLDivElement;
  memoryId: string;
  pendingSelectionKey: string;
  selection: ReaderSelection;
  setErrorMessage: (message: string) => void;
  setPendingSelectionKey: (key: string) => void;
}) {
  if (!canStartHighlightToggle(input.pendingSelectionKey)) {
    return;
  }

  const selection = input.selection;
  const selectionKey = getReaderSelectionKey(selection);
  const previousHtml = input.container.innerHTML;
  const shouldUnhighlight = isRangeFullyMarked(selection.range, input.container);
  const operation: ReaderHighlightOperation = shouldUnhighlight
    ? "unhighlight"
    : "highlight";
  input.setErrorMessage("");
  input.setPendingSelectionKey(selectionKey);
  input.container.focus({ preventScroll: true });

  try {
    applyOptimisticHighlight(selection.range, shouldUnhighlight, input.container);
    window.getSelection()?.removeAllRanges();

    const response = await fetch("/api/highlights", {
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

    const failure = await readHighlightFailure(response);
    if (failure !== undefined) {
      if (shouldRevalidateBackupFailsafeAfterHighlightFailure(failure)) {
        void revalidateBackupFailsafeAlert();
      }

      throw new Error(failure.message);
    }
  } catch {
    input.container.innerHTML = previousHtml;
    input.setErrorMessage("Highlight failed");
  } finally {
    input.setPendingSelectionKey("");
  }
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
      node.parentElement?.closest("mark[data-highlight-id]") !== null,
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

function applyOptimisticHighlight(
  range: Range,
  shouldUnhighlight: boolean,
  container: HTMLElement,
): void {
  if (shouldUnhighlight) {
    const placeholder = document.createElement("span");
    const fragment = range.extractContents();
    stripHighlightElements(fragment);
    placeholder.append(fragment);
    range.insertNode(placeholder);
    liftNodeOutOfHighlightMarks(placeholder);
    placeholder.replaceWith(...Array.from(placeholder.childNodes));
    container.normalize();
    return;
  }

  const mark = document.createElement("mark");
  mark.dataset.highlightId = `pending-${Date.now()}`;
  mark.append(range.extractContents());
  range.insertNode(mark);
  container.normalize();
}

function stripHighlightElements(fragment: DocumentFragment): void {
  for (const mark of [...fragment.querySelectorAll("mark[data-highlight-id]")]) {
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

function liftNodeOutOfHighlightMarks(node: HTMLElement): void {
  let mark =
    node.parentElement?.closest<HTMLElement>("mark[data-highlight-id]") ?? null;

  while (mark !== null) {
    const liftTarget = directChildContaining(mark, node);
    if (liftTarget === undefined) {
      return;
    }

    liftChildOutOfMark(liftTarget, mark);
    mark =
      node.parentElement?.closest<HTMLElement>("mark[data-highlight-id]") ??
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

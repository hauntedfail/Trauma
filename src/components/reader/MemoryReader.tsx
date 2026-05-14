import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";

import { ChevronLeftIcon, OpenIcon } from "../icons";
import type { ReaderMemoryResult } from "../../server/reader/page-data";
import type { ReaderTocEntry } from "../../server/reader/markdown-renderer";
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

type ReaderHighlightOperation = "highlight" | "unhighlight";

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
      {(result) => <ReadyMemoryReader result={result} />}
    </Show>
  );
}

function ReadyMemoryReader(props: { result: ReadyReaderMemoryResult }) {
  let contentRef: HTMLDivElement | undefined;
  const sourceUrl = () => props.result.memory.url;
  const sourceHref = () => toSafeReaderSourceHref(sourceUrl());
  const [pendingSelectionKey, setPendingSelectionKey] = createSignal("");
  const [errorMessage, setErrorMessage] = createSignal("");
  const { setRightRailContent } = useRightRailContent();

  createEffect(() => {
    setRightRailContent(<ReaderToc toc={props.result.rendered.toc} />);
  });

  onCleanup(() => setRightRailContent(undefined));

  const handleSelectionToggle = () => {
    if (contentRef === undefined) {
      return;
    }

    void toggleReaderSelection({
      container: contentRef,
      memoryId: props.result.memory.id,
      pendingSelectionKey: pendingSelectionKey(),
      setErrorMessage,
      setPendingSelectionKey,
    });
  };
  const handleKeyboardSelectionToggle = (event: KeyboardEvent) => {
    if (!isExplicitHighlightKeyboardToggle(event)) {
      return;
    }

    event.preventDefault();
    handleSelectionToggle();
  };

  return (
    <article class={readerFrame} aria-label="Memory">
      <header class={`${readerPadding} trauma-reader-header sticky top-0 z-[1] grid grid-cols-[42px_minmax(0,1fr)] gap-3 border-b border-trauma-border bg-trauma-bg-surface/95 py-6 backdrop-blur`}>
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
            onMouseUp={handleSelectionToggle}
            tabIndex={0}
          />
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
  const [showTocScrollHint, setShowTocScrollHint] = createSignal(false);
  const updateTocScrollHint = () => {
    if (scrollRef === undefined) {
      setShowTocScrollHint(false);
      return;
    }

    const hasOverflow = scrollRef.scrollHeight > scrollRef.clientHeight + 1;
    const hasMoreBelow =
      scrollRef.scrollTop + scrollRef.clientHeight < scrollRef.scrollHeight - 1;
    setShowTocScrollHint(hasOverflow && hasMoreBelow);
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
        <Show when={showTocScrollHint()}>
          <div class="trauma-toc-scroll-spotlight" aria-hidden="true" />
        </Show>
      </nav>
    </Show>
  );
}

async function toggleReaderSelection(input: {
  container: HTMLDivElement;
  memoryId: string;
  pendingSelectionKey: string;
  setErrorMessage: (message: string) => void;
  setPendingSelectionKey: (key: string) => void;
}) {
  if (!canStartHighlightToggle(input.pendingSelectionKey)) {
    return;
  }

  const selection = readReaderSelection(input.container);
  if (selection === undefined) {
    return;
  }

  const selectionKey = `${selection.startOffset}:${selection.endOffset}:${selection.text}`;
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

function readReaderSelection(container: HTMLElement): ReaderSelection | undefined {
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

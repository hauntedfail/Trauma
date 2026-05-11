import { Show, createSignal } from "solid-js";

import type { ReaderMemoryResult } from "../../server/reader/page-data";
import type { ReaderTocEntry } from "../../server/reader/markdown-renderer";
import {
  canStartHighlightToggle,
  isExplicitHighlightKeyboardToggle,
} from "./highlight-events";
import { readerFrame, readerPadding, readerStatePanel } from "./reader-styles";
import { toSafeReaderSourceHref } from "./source-url";

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

const readerArticle =
  "prose max-w-none min-w-0 text-slate-800 prose-headings:text-slate-900 prose-a:text-blue-600 prose-a:underline prose-a:underline-offset-[3px] prose-pre:border prose-pre:border-slate-200 prose-pre:bg-slate-900 prose-pre:text-slate-200 prose-code:font-mono prose-code:text-[0.92em] prose-img:max-w-full prose-table:my-5 prose-table:w-full prose-th:border prose-th:border-slate-300 prose-th:bg-slate-50 prose-th:px-2.5 prose-th:py-2 prose-th:text-left prose-th:text-slate-900 prose-td:border prose-td:border-slate-300 prose-td:px-2.5 prose-td:py-2 prose-mark:rounded prose-mark:bg-yellow-200 prose-mark:px-0.5 prose-mark:text-inherit [&_iframe]:aspect-video [&_iframe]:w-full [&_iframe]:max-w-full [&_iframe]:border-0 [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-slate-100 [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:text-slate-700";

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
    <article class={readerFrame} aria-labelledby="reader-title">
      <header class={`${readerPadding} border-b border-slate-200 py-7`}>
        <p class="mb-1 text-[13px] font-bold uppercase text-trauma-text-muted">Reader mode</p>
        <h1 class="mb-2.5 text-3xl font-bold leading-tight" id="reader-title">{props.result.memory.title}</h1>
        <Show
          when={sourceHref()}
          fallback={<span class="wrap-anywhere text-sm text-blue-600">{sourceUrl()}</span>}
        >
          {(href) => (
            <a
              class="wrap-anywhere text-sm text-blue-600"
              href={href()}
              rel="noreferrer"
              target="_blank"
            >
              {sourceUrl()}
            </a>
          )}
        </Show>
      </header>
      <div class={`${readerPadding} grid grid-cols-[minmax(160px,220px)_minmax(0,1fr)] gap-8 py-7 pb-14 max-[1040px]:grid-cols-1`}>
        <ReaderToc toc={props.result.rendered.toc} />
        <div>
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
              <p class="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" role="status">
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
        <h1 class="mb-2 text-3xl font-bold text-slate-900" id="reader-state-title">{props.message}</h1>
        <p>Open another memory from the archive.</p>
      </div>
    </section>
  );
}

function ReaderToc(props: { toc: ReaderTocEntry[] }) {
  return (
    <nav class="sticky top-6 self-start text-sm text-slate-600 max-[1040px]:static" aria-label="Table of contents">
      <h2 class="mb-3 text-[15px] font-bold text-slate-900">Contents</h2>
      <ol class="m-0 grid gap-2 pl-[18px]">
        {props.toc.map((entry) => (
          <li
            classList={{
              "ml-2.5": entry.level === 2,
              "ml-5": entry.level === 3,
            }}
          >
            <a class="hover:text-blue-600" href={`#${entry.id}`}>{entry.text}</a>
          </li>
        ))}
      </ol>
    </nav>
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

    if (!response.ok) {
      throw new Error("Highlight persistence failed");
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

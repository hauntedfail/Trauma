import { Show } from "solid-js";

import type { ReaderMemoryResult } from "../../server/reader/page-data";
import type { ReaderTocEntry } from "../../server/reader/markdown-renderer";
import { readerFrame, readerPadding, readerStatePanel } from "./reader-styles";
import { toSafeReaderSourceHref } from "./source-url";

interface MemoryReaderProps {
  result: ReaderMemoryResult;
}

type ReadyReaderMemoryResult = Extract<ReaderMemoryResult, { status: "ready" }>;

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
  const sourceUrl = () => props.result.memory.url;
  const sourceHref = () => toSafeReaderSourceHref(sourceUrl());

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
        <div class={readerArticle} innerHTML={props.result.rendered.html} />
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

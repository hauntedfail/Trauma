import { Show } from "solid-js";

import type { ReaderMemoryResult } from "../../server/reader/page-data";
import type { ReaderTocEntry } from "../../server/reader/markdown-renderer";
import { toSafeReaderSourceHref } from "./source-url";

interface MemoryReaderProps {
  result: ReaderMemoryResult;
}

type ReadyReaderMemoryResult = Extract<ReaderMemoryResult, { status: "ready" }>;

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
    <article class="reader-page" aria-labelledby="reader-title">
      <header class="reader-header">
        <p class="eyebrow">Reader mode</p>
        <h1 id="reader-title">{props.result.memory.title}</h1>
        <Show
          when={sourceHref()}
          fallback={<span class="reader-source">{sourceUrl()}</span>}
        >
          {(href) => (
            <a
              class="reader-source"
              href={href()}
              rel="noreferrer"
              target="_blank"
            >
              {sourceUrl()}
            </a>
          )}
        </Show>
      </header>
      <div class="reader-layout">
        <ReaderToc toc={props.result.rendered.toc} />
        <div class="reader-content" innerHTML={props.result.rendered.html} />
      </div>
    </article>
  );
}

function ReaderState(props: { message: string }) {
  return (
    <section class="reader-page" aria-labelledby="reader-state-title">
      <div class="reader-state">
        <h1 id="reader-state-title">{props.message}</h1>
        <p>Open another memory from the archive.</p>
      </div>
    </section>
  );
}

function ReaderToc(props: { toc: ReaderTocEntry[] }) {
  return (
    <nav class="reader-toc" aria-label="Table of contents">
      <h2>Contents</h2>
      <ol>
        {props.toc.map((entry) => (
          <li class={`toc-level-${entry.level}`}>
            <a href={`#${entry.id}`}>{entry.text}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

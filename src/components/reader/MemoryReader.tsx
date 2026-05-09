import { Show } from "solid-js";

import type { ReaderMemoryResult } from "../../server/reader/page-data";
import type { ReaderTocEntry } from "../../server/reader/markdown-renderer";

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
      when={readyResult()}
      fallback={<ReaderState message={stateMessage()} />}
    >
      {(result) => <ReadyMemoryReader result={result()} />}
    </Show>
  );
}

function ReadyMemoryReader(props: { result: ReadyReaderMemoryResult }) {
  return (
    <article class="reader-page" aria-labelledby="reader-title">
      <header class="reader-header">
        <p class="eyebrow">Reader mode</p>
        <h1 id="reader-title">{props.result.memory.title}</h1>
        <a
          class="reader-source"
          href={props.result.memory.url}
          rel="noreferrer"
          target="_blank"
        >
          {props.result.memory.url}
        </a>
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

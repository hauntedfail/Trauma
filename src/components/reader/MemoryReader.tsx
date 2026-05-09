import type { ReaderMemoryResult } from "../../server/reader/page-data";
import type { ReaderTocEntry } from "../../server/reader/markdown-renderer";

interface MemoryReaderProps {
  result: ReaderMemoryResult;
}

export function MemoryReader(props: MemoryReaderProps) {
  if (props.result.status !== "ready") {
    return (
      <section class="reader-page" aria-labelledby="reader-state-title">
        <div class="reader-state">
          <h1 id="reader-state-title">{props.result.message}</h1>
          <p>Open another memory from the archive.</p>
        </div>
      </section>
    );
  }

  const result = props.result;

  return (
    <article class="reader-page" aria-labelledby="reader-title">
      <header class="reader-header">
        <p class="eyebrow">Reader mode</p>
        <h1 id="reader-title">{result.memory.title}</h1>
        <a class="reader-source" href={result.memory.url} rel="noreferrer" target="_blank">
          {result.memory.url}
        </a>
      </header>
      <div class="reader-layout">
        <ReaderToc toc={result.rendered.toc} />
        <div class="reader-content" innerHTML={result.rendered.html} />
      </div>
    </article>
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

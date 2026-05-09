import { Title } from "@solidjs/meta";
import { createAsync, useParams } from "@solidjs/router";
import { For, Show, createMemo } from "solid-js";

import { getMemoryReaderHighlights } from "~/components/memories/browse-data";
import { getBrowseMemories } from "~/components/memories/browse-loader";

export default function MemoryReaderPlaceholder() {
  const params = useParams();
  const memories = createAsync(() => getBrowseMemories());
  const browseMemories = createMemo(() => memories() ?? []);
  const memory = createMemo(() => browseMemories().find((item) => item.id === params.id));

  return (
    <section class="timeline" aria-labelledby="memory-reader-title">
      <Title>{memory()?.title ?? "Memory"} | Trauma</Title>
      <header class="timeline-header">
        <div>
          <p class="eyebrow">Reader placeholder</p>
          <h1 id="memory-reader-title">{memory()?.title ?? "Memory reader"}</h1>
        </div>
      </header>
      <Show
        when={memory()}
        fallback={
          <div class="empty-state">
            <h2>Memory not found</h2>
            <p>The reader route exists, but this memory is not available in the current repository data.</p>
          </div>
        }
      >
        {(selectedMemory) => (
          <article class="memory-item" data-view="list">
            <p class="memory-url">{selectedMemory().url}</p>
            <p>{selectedMemory().description}</p>
            <Show when={getMemoryReaderHighlights(selectedMemory()).length > 0}>
              <div class="reader-highlights" aria-label="Highlights in this memory">
                <For each={getMemoryReaderHighlights(selectedMemory())}>
                  {(highlight) => (
                    <blockquote>
                      <span>{highlight.prefix}</span>
                      <mark id={highlight.anchorId}>{highlight.text}</mark>
                      <span>{highlight.suffix}</span>
                    </blockquote>
                  )}
                </For>
              </div>
            </Show>
          </article>
        )}
      </Show>
    </section>
  );
}

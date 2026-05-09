import { Title } from "@solidjs/meta";
import { createAsync } from "@solidjs/router";
import { For, createMemo } from "solid-js";

import { getBrowseMemories } from "~/components/memories/browse-loader";

export default function HighlightsIndex() {
  const memories = createAsync(() => getBrowseMemories(), { initialValue: [] });
  const highlights = createMemo(() =>
    memories().flatMap((memory) =>
      memory.highlights.map((highlight) => ({
        ...highlight,
        memoryId: memory.id,
        memoryTitle: memory.title,
      })),
    ),
  );

  return (
    <section class="timeline" aria-labelledby="highlights-title">
      <Title>Highlights | Trauma</Title>
      <header class="timeline-header">
        <div>
          <p class="eyebrow">Highlighted excerpts</p>
          <h1 id="highlights-title">Highlights</h1>
        </div>
      </header>
      <div class="memory-list">
        <For
          each={highlights()}
          fallback={
            <div class="empty-state">
              <h2>No highlights yet</h2>
              <p>Saved reader highlights will appear here.</p>
            </div>
          }
        >
          {(highlight) => (
            <article class="memory-item" data-view="list">
              <header>
                <div>
                  <p class="memory-date">Source memory</p>
                  <h2>
                    <a href={`/memories/${highlight.memoryId}#${highlight.id}`}>{highlight.memoryTitle}</a>
                  </h2>
                </div>
              </header>
              <blockquote>
                <span>{highlight.prefix}</span>
                <mark>{highlight.text}</mark>
                <span>{highlight.suffix}</span>
              </blockquote>
            </article>
          )}
        </For>
      </div>
    </section>
  );
}
